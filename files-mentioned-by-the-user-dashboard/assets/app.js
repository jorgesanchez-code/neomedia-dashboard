// ==================== CONFIGURACIÓN ====================
const EmailService = window.emailjs || {
    init() {},
    async send() {
        throw new Error('EmailJS no está disponible. Revisa la conexión a internet o la configuración del servicio.');
    }
};
const EMAILJS_DEFAULTS = {
    publicKey: '',
    serviceId: '',
    templateId: ''
};
function getEmailConfig() {
    return {
        publicKey: localStorage.getItem('emailjs_public_key') || EMAILJS_DEFAULTS.publicKey,
        serviceId: localStorage.getItem('emailjs_service_id') || EMAILJS_DEFAULTS.serviceId,
        templateId: localStorage.getItem('emailjs_template_id') || EMAILJS_DEFAULTS.templateId
    };
}
function initEmailService() {
    const cfg = getEmailConfig();
    if(!window.emailjs) return { ok:false, reason:'La librería EmailJS no cargó. Revisa internet o el CDN.' };
    if(!cfg.publicKey || !cfg.serviceId || !cfg.templateId) return { ok:false, reason:'Falta configurar Public Key, Service ID o Template ID de EmailJS.' };
    try {
        EmailService.init(cfg.publicKey);
        return { ok:true, cfg };
    } catch(e) {
        return { ok:false, reason:e.message || String(e) };
    }
}
function nmTimestamp() {
    if (window.dayjs) return dayjs().format('YYYY-MM-DD_HHmmss');
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ==================== UTILIDADES ====================
const Toast = {
    show(msg, type = 'info', duration = 4000) {
        const c = document.getElementById('toastContainer');
        if (!c) return;
        const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-msg">${msg}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button><div class="toast-progress" style="animation-duration:${duration}ms"></div>`;
        c.prepend(el);
        setTimeout(() => { el.style.animation = 'toastOut 0.3s forwards'; setTimeout(() => el.remove(), 300); }, duration);
    }
};

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function validatePassword(pwd) {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(pwd);
}


// ==================== SISTEMA DE ROLES ====================
const ROLES = {
    admin:      { label: '👑 Admin',       tabs: ['monitor','support','history','charts','assistant','backup','alerts','users'], canImportCSV: true,  canChangeStatus: true,  canCreateTicket: true,  canEditTicket: true  },
    supervisor: { label: '🔭 Supervisor',  tabs: ['monitor','support','history','charts','assistant'],                          canImportCSV: true,  canChangeStatus: false, canCreateTicket: true,  canEditTicket: true  },
    tecnico:    { label: '🔧 Técnico',     tabs: ['support','history','assistant'],                                             canImportCSV: false, canChangeStatus: false, canCreateTicket: true,  canEditTicket: true  },
    readonly:   { label: '👁️ Solo lectura', tabs: ['monitor','support','history','assistant'],                                  canImportCSV: false, canChangeStatus: false, canCreateTicket: false, canEditTicket: false },
};
const ROLE_BADGE = {
    admin:      '<span class="role-badge role-admin">👑 Admin</span>',
    supervisor: '<span class="role-badge role-supervisor">🔭 Supervisor</span>',
    tecnico:    '<span class="role-badge role-tecnico">🔧 Técnico</span>',
    readonly:   '<span class="role-badge role-readonly">👁️ Solo lectura</span>',
};
function can(permission) {
    const role = currentUser?.role || 'readonly';
    return ROLES[role]?.[permission] ?? false;
}
function hasTabAccess(tab) {
    const role = currentUser?.role || 'readonly';
    return ROLES[role]?.tabs?.includes(tab) ?? false;
}

// ==================== FIREBASE AUTH & FIRESTORE HELPERS ====================
const ADMIN_EMAIL = 'jorge.sanchez@neomediadigital.com';

function _fb() { return window._fb; }

// ── Usuarios ──
async function getUsers() {
    const { db, collection, getDocs } = _fb();
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addUser(email, password, addedBy, isProvisional = true, role = 'tecnico') {
    const { auth, db, createUserWithEmailAndPassword, doc, setDoc, serverTimestamp } = _fb();
    // Guardar auth actual para restaurar después
    const prevUser = auth.currentUser;
    try {
        // Crear en Firebase Auth con cuenta temporal
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        // Guardar metadatos en Firestore
        await setDoc(doc(db, 'users', email), {
            email, role, isProvisional, addedBy: addedBy || 'sistema',
            addedAt: serverTimestamp(), uid: cred.user.uid
        });
        // Restaurar sesión del admin si había uno logueado
        if (prevUser && prevUser.email !== email) {
            // Re-login del admin (no podemos restaurar directamente; el admin debe volver a loguearse)
            // Forzamos logout del nuevo usuario y recarga de la sesión del admin
            // Solución: guardamos que debe re-autenticarse
            window._needReauth = true;
        }
        return true;
    } catch(e) {
        console.error('addUser error:', e);
        return false;
    }
}

async function updatePassword(email, newPassword, isProvisional = false) {
    const { auth, db, doc, updateDoc } = _fb();
    // Solo podemos cambiar la contraseña del usuario actualmente logueado
    if (auth.currentUser?.email === email) {
        await _fb().fbUpdatePassword(auth.currentUser, newPassword);
    }
    await updateDoc(doc(db, 'users', email), { isProvisional });
    return true;
}

async function updateUserRole(email, newRole) {
    if (email === ADMIN_EMAIL) return false;
    const { db, doc, updateDoc } = _fb();
    await updateDoc(doc(db, 'users', email), { role: newRole });
    return true;
}

async function removeUser(email) {
    if (email === ADMIN_EMAIL) return false;
    const { db, doc, deleteDoc } = _fb();
    // Eliminar metadatos de Firestore (la cuenta Auth se puede eliminar desde consola Firebase)
    await deleteDoc(doc(db, 'users', email));
    return true;
}

async function authenticate(email, password) {
    const { auth, db, signInWithEmailAndPassword, doc, getDoc, setDoc, serverTimestamp } = _fb();
    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        // Leer metadatos del usuario en Firestore
        const snap = await getDoc(doc(db, 'users', email));
        let role = 'tecnico'; let isProvisional = false;
        if (snap.exists()) {
            role = snap.data().role || 'tecnico';
            isProvisional = snap.data().isProvisional || false;
        } else {
            // Primera vez — crear documento en Firestore
            const isAdmin = email === ADMIN_EMAIL;
            role = isAdmin ? 'admin' : 'tecnico';
            await setDoc(doc(db, 'users', email), {
                email, role, isProvisional: false,
                addedBy: 'sistema', addedAt: serverTimestamp(), uid: cred.user.uid
            });
        }
        // El admin fijo siempre tiene rol admin
        if (email === ADMIN_EMAIL) role = 'admin';
        return { email, isProvisional, role, isAdmin: role === 'admin' };
    } catch(e) {
        console.error('authenticate error:', e.code, e.message);
        return null;
    }
}

async function ensureAdminExists() {
    // El admin se crea en Firebase Auth la primera vez que hace login.
    // Aquí solo verificamos que su doc en Firestore exista; si no, se creará en authenticate().
    return true;
}
function escapeHtml(s) {
    if(s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
}
function escapeAttr(s) { return escapeHtml(s); }
function safeIdForJs(s) { return encodeURIComponent(String(s || '')); }
function decodeSafeId(s) {
    try { return decodeURIComponent(String(s || '')); }
    catch(e) { return String(s || ''); }
}

// ==================== LOGIN ====================
async function renderLoginScreen() {
    const area = document.getElementById('loginFormArea');
    if (!area) return;

    function _setErr(id, msg) {
        const el = document.getElementById(id);
        if(el) { el.innerText = msg; el.style.display = msg ? 'block' : 'none'; }
    }
    window._togglePwd = function(inputId, btn) {
        const inp = document.getElementById(inputId);
        if(!inp) return;
        const isText = inp.type === 'text';
        inp.type = isText ? 'password' : 'text';
        btn.textContent = isText ? '👁️' : '🙈';
    }

    // Esperar a que Firebase esté listo
    let waits = 0;
    while (!window._fb && waits < 50) { await new Promise(r => setTimeout(r, 100)); waits++; }

    try {
        area.innerHTML = `
            <div class="login-field-wrap">
                <span class="login-field-icon">✉️</span>
                <input type="email" id="loginEmail" placeholder="Correo electrónico" autocomplete="email" maxlength="100">
            </div>
            <div class="login-field-wrap">
                <span class="login-field-icon">🔒</span>
                <input type="password" id="loginPassword" placeholder="Contraseña" autocomplete="current-password" maxlength="128">
                <button type="button" class="login-pwd-toggle" onclick="_togglePwd('loginPassword',this)">👁️</button>
            </div>
            <div id="loginError" class="error-msg" style="display:none"></div>
            <button class="login-btn" id="doLoginBtn">Iniciar sesión</button>
            <hr class="login-divider">
            <div class="login-footer">Plataforma exclusiva · Solo usuarios autorizados</div>`;

        document.getElementById('loginEmail')?.addEventListener('input', () => _setErr('loginError', ''));
        document.getElementById('loginPassword')?.addEventListener('input', () => _setErr('loginError', ''));
        area.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('keydown', e => { if(e.key === 'Enter') document.getElementById('doLoginBtn')?.click(); });
        });

        const doLogin = async () => {
            const email = document.getElementById('loginEmail')?.value.trim().toLowerCase();
            const pwd   = document.getElementById('loginPassword')?.value;
            const btn   = document.getElementById('doLoginBtn');
            _setErr('loginError', '');
            if(!email || !pwd) { _setErr('loginError', 'Introduce correo y contraseña'); return; }
            if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _setErr('loginError', '📧 El correo electrónico no es válido'); return; }
            if(btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }
            const user = await authenticate(email, pwd);
            if(!user) {
                _setErr('loginError', '❌ Credenciales incorrectas. Verifica tu correo y contraseña.');
                if(btn) { btn.disabled = false; btn.textContent = 'Iniciar sesión'; }
                document.getElementById('loginPassword').value = '';
                document.getElementById('loginPassword').focus();
                const card = document.querySelector('.login-card');
                if(card) { card.style.animation = 'none'; card.offsetHeight; card.style.animation = 'loginShake 0.4s ease'; }
                return;
            }
            currentUser = user;
            document.getElementById('loginOverlay').style.display = 'none';
            applyRolePermissions(user);
            if(user.isProvisional) {
                Toast.show('⚠️ Debes cambiar tu contraseña provisional.', 'warning');
                openChangePasswordModal(true);
            }
            loadUserListUI();
            startupSequence();
        };
        document.getElementById('doLoginBtn').addEventListener('click', doLogin);

    } catch (e) {
        console.error('No se pudo renderizar el login', e);
        area.innerHTML = `<div class="error-msg" style="display:block;margin-bottom:14px">Error al cargar. Recarga la página.</div>`;
    }
}

// ==================== CAMBIO DE CONTRASEÑA ====================
let pendingProvisional = false;

function applyRolePermissions(user) {
    const role = user.role || 'readonly';
    const perms = ROLES[role] || ROLES.readonly;
    if (!perms.tabs.includes('assistant')) perms.tabs.push('assistant');

    // Mostrar/ocultar tabs según rol
    document.querySelectorAll('.sidebar-item[data-tab]').forEach(item => {
        const tab = item.dataset.tab;
        const visible = perms.tabs.includes(tab);
        item.style.display = visible ? 'flex' : 'none';
    });

    // CSV import
    const csvLabel = document.querySelector('.upload-label');
    if (csvLabel) csvLabel.style.display = perms.canImportCSV ? '' : 'none';

    // Botón de cambio de estado (manual)
    // Se oculta dinámicamente en _fillGroupList y _renderTable via can()

    // Mostrar perfil en header
    const userTop = document.querySelector('.user-top');
    if (userTop) {
        userTop.innerHTML = `<i>👤</i><span class="user-top-email" id="topUserEmail">${user.email}</span>${ROLE_BADGE[role]||''}`;
    }
}

function openChangePasswordModal(isProvisional = false) {
    pendingProvisional = isProvisional;
    document.getElementById('newPwd1').value = '';
    document.getElementById('newPwd2').value = '';
    document.getElementById('pwdError').innerText = '';
    document.getElementById('changePasswordModal').classList.add('active');
}


// ==================== ADMIN: RESET PASSWORD ====================
let resetTargetEmail = null;
function openResetPasswordModal(email) {
    resetTargetEmail = email;
    document.getElementById('resetUserEmail').innerText = `Usuario: ${email}`;
    document.getElementById('resetNewPwd').value = '';
    document.getElementById('resetPwdError').innerText = '';
    document.getElementById('resetPasswordModal').classList.add('active');
}


async function loadUserListUI() {
    if (!currentUser || !currentUser.isAdmin) return;
    const container = document.getElementById('userListContainer');
    if (!container) return;
    let users = [];
    try {
        users = await getUsers();
    } catch(e) {
        console.error('No se pudieron cargar usuarios:', e);
        container.innerHTML = '<div class="empty-state">No se pudieron cargar usuarios</div>';
        return;
    }
    if (!users.length) { container.innerHTML = '<div class="empty-state">No hay usuarios</div>'; return; }
    let html = `<div style="display:flex;flex-direction:column;gap:10px">`;
    for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const isFirstAdmin = u.email === 'jorge.sanchez@neomediadigital.com';
        const role = isFirstAdmin ? 'admin' : (u.role || 'tecnico');
        const isSelf = u.email === currentUser.email;
        html += `<div class="user-item" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-sm);flex-wrap:wrap">
            <div style="flex:1;min-width:180px">
                <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:3px">
                    ${escapeHtml(u.email)}
                    ${u.isProvisional ? '<span style="font-size:0.6rem;background:var(--warning-dim);color:var(--warning);padding:1px 6px;border-radius:6px;margin-left:4px">provisional</span>' : ''}
                    ${isSelf ? '<span style="font-size:0.6rem;color:var(--text-muted);margin-left:4px">(tú)</span>' : ''}
                </div>
                <div style="font-size:0.74rem;color:var(--text-muted)">
                    ${ROLE_BADGE[role] || role} &nbsp;·&nbsp; Desde ${new Date(u.addedAt||Date.now()).toLocaleDateString()}
                    ${u.addedBy && u.addedBy !== 'sistema' ? ` · Añadido por ${escapeHtml(u.addedBy)}` : ''}
                </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                ${!isFirstAdmin ? `<button class="action-pill edit-user-btn" data-email="${escapeAttr(u.email)}" style="padding:5px 12px;font-size:0.78rem">✏️ Editar</button>` : '<span style="font-size:0.72rem;background:var(--accent-dim);color:var(--accent);padding:3px 10px;border-radius:20px;border:1px solid var(--border-light)">👑 Administrador principal</span>'}
                <button class="action-pill reset-pwd-btn" data-email="${escapeAttr(u.email)}" style="padding:5px 12px;font-size:0.78rem">🔄 Reset pwd</button>
                ${!isSelf && !isFirstAdmin ? `<button class="action-pill danger remove-user-btn" data-email="${escapeAttr(u.email)}" style="padding:5px 12px;font-size:0.78rem">🗑️ Eliminar</button>` : ''}
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
    document.querySelectorAll('.edit-user-btn').forEach(btn => btn.addEventListener('click', () => openEditUserModal(btn.dataset.email)));
    document.querySelectorAll('.reset-pwd-btn').forEach(btn => btn.addEventListener('click', () => openResetPasswordModal(btn.dataset.email)));
    document.querySelectorAll('.remove-user-btn').forEach(btn => btn.addEventListener('click', async () => {
        const email = btn.dataset.email;
        if (email === currentUser.email) { Toast.show('No puedes eliminarte a ti mismo', 'error'); return; }
        if (confirm(`¿Eliminar a ${email}?`)) { await removeUser(email); Toast.show('Usuario eliminado', 'success'); loadUserListUI(); }
    }));
}

// ==================== MODAL EDITAR USUARIO ====================
let _editUserTarget = null;
async function openEditUserModal(email) {
    let users = [];
    try {
        users = await getUsers();
    } catch(e) {
        console.error('No se pudo leer el usuario:', e);
        Toast.show('No se pudo cargar el usuario', 'error');
        return;
    }
    const u = users.find(x => x.email === email);
    if (!u) return;
    _editUserTarget = email;
    const role = u.role || 'tecnico';
    document.getElementById('editUserEmail').value = email;
    document.getElementById('editUserRole').value = role;
    document.getElementById('editUserNewPwd').value = '';
    document.getElementById('editUserError').style.display = 'none';
    document.getElementById('editUserInfoBox').innerHTML = `<strong>Usuario:</strong> ${escapeHtml(email)}<br><span style="font-size:0.72rem;color:var(--text-muted)">Rol actual: ${ROLES[role]?.label || role}</span>`;
    document.getElementById('editUserModal').classList.add('active');
}
document.getElementById('submitEditUser')?.addEventListener('click', async () => {
    const newRole = document.getElementById('editUserRole').value;
    const newPwd  = document.getElementById('editUserNewPwd').value;
    const errEl   = document.getElementById('editUserError');
    errEl.style.display = 'none';
    if (!_editUserTarget) return;
    if (newPwd && !validatePassword(newPwd)) {
        errEl.innerText = 'La contraseña debe tener 8+ caracteres, mayúscula, minúscula, número y símbolo (@$!%*?&)';
        errEl.style.display = 'block'; return;
    }
    const btn = document.getElementById('submitEditUser');
    if(btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
    await updateUserRole(_editUserTarget, newRole);
    if (newPwd && _editUserTarget === currentUser?.email) {
        // Solo podemos cambiar la contraseña del usuario actual via Firebase SDK
        await updatePassword(_editUserTarget, newPwd, false);
        Toast.show(`✅ Rol y contraseña actualizados`, 'success');
    } else if (newPwd) {
        Toast.show(`⚠️ Rol actualizado. La contraseña solo se puede cambiar cuando el usuario esté logueado.`, 'warning', 5000);
    } else {
        Toast.show(`✅ Rol de ${_editUserTarget} actualizado`, 'success');
    }
    if(btn) { btn.disabled = false; btn.textContent = '💾 Guardar cambios'; }
    closeModal('editUserModal');
    loadUserListUI();
    _editUserTarget = null;
});

// ==================== CLASE APP (sin cambios, mantiene datos) ====================
const CFG = { DEBOUNCE: 300, STORAGE_KEY: 'neomedia_v2', MAX_HISTORY: 500, KNOWN_CLIENTS: ['BANISTMO','REY','ROMERO','ZAZ','C&X','MR BONO','MONASTERY'] };
class App {
    constructor() {
        this.devices = new Map(); this.baseDevices = new Map(); this.supports = new Map(); this.historyChanges = []; this.nextTicket = 1; this.watchlist = new Set(); this._listeners = []; this._saveTimer = null;
        // localStorage como caché local (fallback offline)
        this.loadFromStorage();
    }
    loadFromStorage() {
        // 1. Primero cargar desde localStorage (respuesta inmediata)
        try {
            let raw = localStorage.getItem(CFG.STORAGE_KEY);
            if(raw) {
                let d = JSON.parse(raw);
                if(d.baseDevices) this.baseDevices = new Map(Object.entries(d.baseDevices));
                if(d.devices) this.devices = new Map(Object.entries(d.devices));
                if(d.supports) this.supports = new Map(Object.entries(d.supports));
                this.historyChanges = d.historyChanges || [];
                this.nextTicket = d.nextTicket || 1;
                this.watchlist = new Set(d.watchlist || []);
            }
        } catch(e) {}
        // 2. Luego sincronizar desde Firestore (en background)
        this._syncFromFirestore();
    }
    async _syncFromFirestore() {
        if (!window._fb || !currentUser) return;
        const { db, doc, getDoc } = window._fb;
        try {
            const snap = await getDoc(doc(db, 'appdata', 'main'));
            if (snap.exists()) {
                const d = snap.data();
                if(d.baseDevices) this.baseDevices = new Map(Object.entries(d.baseDevices));
                if(d.devices)     this.devices     = new Map(Object.entries(d.devices));
                if(d.supports)    this.supports    = new Map(Object.entries(d.supports));
                this.historyChanges = d.historyChanges || [];
                this.nextTicket     = d.nextTicket || this.nextTicket || 1;
                this.watchlist      = new Set(d.watchlist || []);
                // Actualizar caché local
                this._writeLocalCache();
                // Re-renderizar UI con datos frescos
                if(window._ui) { _ui._updateDropdowns(); _ui.render(); _ui._updateWatchlist(); _ui._updateCharts(); }
                Toast.show('☁️ Datos sincronizados desde la nube', 'success', 2500);
            }
        } catch(e) { console.warn('Firestore sync error:', e); }
    }
    _writeLocalCache() {
        let data = {
            baseDevices: Object.fromEntries(this.baseDevices),
            devices:     Object.fromEntries(this.devices),
            supports:    Object.fromEntries(this.supports),
            historyChanges: this.historyChanges,
            nextTicket:  this.nextTicket,
            watchlist:   [...this.watchlist],
            savedAt:     new Date().toISOString()
        };
        localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(data));
    }
    saveToStorage() {
        this._pendingSave = true;
        SaveManager.markUnsaved();
        clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => this._doSave(), 800);
    }
    async _doSave() {
        let data = {
            baseDevices: Object.fromEntries(this.baseDevices),
            devices:     Object.fromEntries(this.devices),
            supports:    Object.fromEntries(this.supports),
            historyChanges: this.historyChanges,
            nextTicket:  this.nextTicket,
            watchlist:   [...this.watchlist],
            savedAt:     new Date().toISOString()
        };
        // 1. Guardar en localStorage inmediatamente
        localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(data));
        // 2. Guardar en Firestore
        if (window._fb && currentUser) {
            const { db, doc, setDoc, serverTimestamp } = window._fb;
            try {
                await setDoc(doc(db, 'appdata', 'main'), { ...data, updatedAt: serverTimestamp(), updatedBy: currentUser.email });
                SaveManager.markSaved();
            } catch(e) {
                console.warn('Firestore save error:', e);
                SaveManager.markSaved(); // guardar igual (tenemos local)
                Toast.show('⚠️ Guardado local (sin conexión a nube)', 'warning', 3000);
            }
        } else {
            SaveManager.markSaved();
        }
        this._pendingSave = false;
    }
    saveNow() {
        clearTimeout(this._saveTimer);
        this._doSave();
    }
    subscribe(fn) { this._listeners.push(fn); }
    notify() { this._listeners.forEach(fn=>fn(this)); this.saveToStorage(); }
    async loadCSV(files) {
        this.showLoading(true);
        let newDevices = new Map();
        for(let file of files) {
            let text = await this._readFile(file);
            let rows = this._parseCSV(text);
            for(let row of rows) { let d = this._rowToDevice(row); if(d) { let ex = newDevices.get(d.id); if(!ex || d.ultimoAcceso > ex.ultimoAcceso) newDevices.set(d.id,d); } }
        }
        let changes = [];
        if(this.baseDevices.size===0) { for(let [id,d] of newDevices) this.baseDevices.set(id,this._baseOf(d)); }
        else {
            for(let [id,nd] of newDevices) {
                let base = this.baseDevices.get(id);
                if(base) { nd.cliente=base.cliente; nd.nombre=base.nombre; nd.pais=base.pais; nd.ip=base.ip; nd.so=base.so; nd.ubicacion=base.ubicacion; nd.almacenamientoLibre=base.almacenamientoLibre; }
                else this.baseDevices.set(id,this._baseOf(nd));
                let od = this.devices.get(id);
                if(!od) changes.push(this._mkChange(nd,'nuevo',nd.alertLevel,'new'));
                else if(od.alertLevel !== nd.alertLevel) changes.push(this._mkChange(nd,od.alertLevel,nd.alertLevel,'status'));
            }
            for(let [id,od] of this.devices) if(!newDevices.has(id)) changes.push(this._mkChange(od,od.alertLevel,'eliminado','removed'));
        }
        this.devices = newDevices;
        if(changes.length) { this.historyChanges = [...changes,...this.historyChanges].slice(0,CFG.MAX_HISTORY); Toast.show(`🆕 ${changes.filter(c=>c.changeType==='new').length} nuevos · ❌ ${changes.filter(c=>c.changeType==='removed').length} eliminados · 🔄 ${changes.filter(c=>c.changeType==='status').length} cambios`, 'info'); }
        else if(this.devices.size) Toast.show(`✅ ${this.devices.size} dispositivos cargados`,'success');
        this.showLoading(false); this.notify();
    }
    _baseOf(d) { return { id:d.id, cliente:d.cliente, nombre:d.nombre, pais:d.pais, ip:d.ip, so:d.so, ubicacion:d.ubicacion, almacenamientoLibre:d.almacenamientoLibre }; }
    _mkChange(d, oldS, newS, type, note='') { return { deviceId:d.id, deviceName:d.nombre, cliente:d.cliente, pais:d.pais, oldStatus:oldS, newStatus:newS, timestamp:new Date().toISOString(), daysOffline:d.diasDesconexion||0, lastAccess:d.ultimoAcceso, changeType:type, note, user:currentUser?.email || 'sistema' }; }
    _readFile(f) { return new Promise((res,rej)=>{ let r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsText(f,'UTF-8'); }); }
    _parseCSV(t) { if(t.charCodeAt(0)===0xFEFF) t=t.slice(1); let l=t.split(/\r?\n/); if(l.length<2) return []; let h=this._splitCSVLine(l[0]).map(x=>x.replace(/^"|"$/g,'')); let d=[]; for(let i=1;i<l.length;i++){ if(!l[i].trim()) continue; let v=this._splitCSVLine(l[i]); let o={}; h.forEach((k,idx)=>{ o[k]=(v[idx]||'').replace(/^"|"$/g,''); }); d.push(o); } return d; }
    _splitCSVLine(l){ let r=[], inQ=false, cur=''; for(let c of l){ if(c==='"') inQ=!inQ; else if(c===',' && !inQ){ r.push(cur.trim()); cur=''; } else cur+=c; } r.push(cur.trim()); return r; }
    _rowToDevice(row){
        let name = row['Pantalla'] || row['Nombre del dispositivo'] || ''; if(!name) return null;
        let mac = row['Dirección Mac'] || ''; let ip = row['Dirección IP'] || '';
        let id = `${name}_${mac}_${ip}`.replace(/\s/g,''); let client = this._extractClient(name);
        let last = row['Último Acceso'] || ''; let days = this._calcDays(last);
        let isConn = (row['Conectado']==='1'||row['Conectado']===1||row['Conectado']===true||row['Conectado']==='true');
        let alertLevel = isConn ? 'connected' : (days!==null && days>=7 ? 'critical' : (days!==null && days>=2 ? 'warning' : 'disconnected'));
        return { id, cliente:client, nombre:name, pais:this._getCountry(client,name), estado:isConn?'connected':'disconnected', diasDesconexion:days, ultimoAcceso:last||'N/A', alertLevel, almacenamientoLibre:row['Almacenamiento libre %']||'N/A', ip:ip||'N/A', so:row['Versión del SO']||row['Versión']||'N/A', ubicacion:row['Address']||row['Zona horaria']||'N/A' };
    }
    _extractClient(n){ if(!n) return 'Sin cliente'; for(let k of CFG.KNOWN_CLIENTS) if(n.toUpperCase().includes(k)) return k; return 'Sin cliente'; }
    _getCountry(c,n){ let m={'C&X':'🇨🇴 Colombia','BANISTMO':'🇵🇦 Panamá','REY':'🇵🇦 Panamá','ROMERO':'🇵🇦 Panamá','ZAZ':'🇵🇦 Panamá'}; if(m[c]) return m[c]; if(n.includes('CO-NDP')||n.includes(' - CO')) return '🇨🇴 Colombia'; if(n.includes('PA-NDP')||n.includes(' - PA')) return '🇵🇦 Panamá'; return '🌎 Otro'; }
    _calcDays(l){ if(!l || l==='' || l==='0') return null; try{ let d; if(l.includes('-') && l.split('-')[0].length===2){ let p=l.split(' '); let dp=p[0].split('-'); d=new Date(dp[2],dp[1]-1,dp[0]); let tp=p[1]?p[1].split(':') : [0,0]; d.setHours(parseInt(tp[0])||0,parseInt(tp[1])||0); } else d=new Date(l); return isNaN(d)?null:Math.max(0,(Date.now()-d.getTime())/86400000); } catch(e){ return null; } }
    getDevices() { return [...this.devices.values()]; }
    manualStatusChange(deviceId, newStatus, note) {
        let device = this.devices.get(deviceId); if(!device) return false;
        let oldStatus = device.alertLevel; if(oldStatus===newStatus) return false;
        let updated = {...device, alertLevel:newStatus, estado:newStatus==='connected'?'connected':'disconnected'};
        if(newStatus==='connected') { updated.diasDesconexion=0; updated.ultimoAcceso=new Date().toLocaleString(); }
        else updated.diasDesconexion=0.1;
        this.devices.set(deviceId, updated);
        let change = this._mkChange(updated, oldStatus, newStatus, 'manual', note || 'Cambio manual');
        this.historyChanges.unshift(change); if(this.historyChanges.length>CFG.MAX_HISTORY) this.historyChanges.pop();
        let deviceName = device.nombre;
        this.addSupport(deviceId, { date:new Date().toISOString().split('T')[0], type:'conectividad', technician:currentUser.email, description:`Cambio manual: ${oldStatus} → ${newStatus}. ${note? 'Motivo: '+note : ''}`, result:'resuelto', deviceName: deviceName });
        this.notify(); return true;
    }
    bulkStatusChange(deviceIds, newStatus) { let changed=0; for(let id of deviceIds){ let d=this.devices.get(id); if(!d || d.alertLevel===newStatus) continue; let old=d.alertLevel; let u={...d, alertLevel:newStatus, estado:newStatus==='connected'?'connected':'disconnected'}; if(newStatus==='connected'){ u.diasDesconexion=0; u.ultimoAcceso=new Date().toLocaleString(); } else u.diasDesconexion=0.1; this.devices.set(id,u); this.historyChanges.unshift(this._mkChange(u,old,newStatus,'manual','Cambio masivo')); changed++; } if(this.historyChanges.length>CFG.MAX_HISTORY) this.historyChanges=this.historyChanges.slice(0,CFG.MAX_HISTORY); if(changed) this.notify(); return changed; }
    addSupport(deviceId, ticket) {
        if(!this.supports.has(deviceId)) this.supports.set(deviceId, []);
        // Siempre forzar el nombre guardado desde baseDevices (nombre persistente)
        let baseD = this.baseDevices.get(deviceId) || this.devices.get(deviceId);
        ticket.deviceName = (baseD && baseD.nombre) ? baseD.nombre : (ticket.deviceName || 'Dispositivo desconocido');
        ticket.deviceId = deviceId;
        ticket.ticketNumber = this.nextTicket++;
        ticket.createdAt = ticket.createdAt || new Date().toISOString();
        this.supports.get(deviceId).unshift(ticket);
        this.saveToStorage();
        return ticket.ticketNumber;
    }
    updateTicket(deviceId, ticketNumber, updatedTicket) {
        let tickets = this.supports.get(deviceId);
        if(!tickets) return false;
        let idx = tickets.findIndex(t => t.ticketNumber === ticketNumber);
        if(idx === -1) return false;
        updatedTicket.ticketNumber = ticketNumber;
        // Preservar siempre el nombre guardado original
        let baseD = this.baseDevices.get(deviceId) || this.devices.get(deviceId);
        updatedTicket.deviceName = (baseD && baseD.nombre) ? baseD.nombre : (tickets[idx].deviceName || 'Dispositivo desconocido');
        updatedTicket.deviceId = deviceId;
        tickets[idx] = { ...tickets[idx], ...updatedTicket };
        this.saveToStorage();
        this.notify();
        return true;
    }
    getSupports(deviceId) { return this.supports.get(deviceId) || []; }
    getAllSupports() { let all=[]; for(let [id, ts] of this.supports) { for(let t of ts) { t.deviceId = id; all.push(t); } } return all.sort((a,b)=>b.ticketNumber-a.ticketNumber); }
    toggleWatch(deviceId) { if(this.watchlist.has(deviceId)) this.watchlist.delete(deviceId); else this.watchlist.add(deviceId); this.saveToStorage(); return this.watchlist.has(deviceId); }
    exportBackup() { return JSON.stringify({ version:2, exportedAt:new Date().toISOString(), baseDevices:Object.fromEntries(this.baseDevices), supports:Object.fromEntries(this.supports), historyChanges:this.historyChanges, nextTicket:this.nextTicket, watchlist:[...this.watchlist] },null,2); }
    importBackup(json) { let data=JSON.parse(json); if(!data.baseDevices) throw new Error('Backup inválido'); this.baseDevices=new Map(Object.entries(data.baseDevices)); this.supports=new Map(Object.entries(data.supports||{})); this.historyChanges=data.historyChanges||[]; this.nextTicket=data.nextTicket||1; this.watchlist=new Set(data.watchlist||[]); this.devices=new Map(); this.saveToStorage(); this.notify(); }
    clearAll() {
        this.devices=new Map(); this.baseDevices=new Map(); this.supports=new Map(); this.historyChanges=[]; this.nextTicket=1; this.watchlist=new Set();
        localStorage.removeItem(CFG.STORAGE_KEY);
        if (window._fb && currentUser) {
            const { db, doc, deleteDoc } = window._fb;
            deleteDoc(doc(db, 'appdata', 'main')).catch(e => console.warn('Firestore clearAll error:', e));
        }
        this.notify();
    }
    showLoading(show) { let el=document.getElementById('loadingOverlay'); if(el) el.style.display=show?'flex':'none'; }
    getStorageInfo() { let raw=localStorage.getItem(CFG.STORAGE_KEY)||''; let kb=(raw.length*2/1024).toFixed(1); return { devices:this.devices.size, baseDevices:this.baseDevices.size, tickets:this.getAllSupports().length, historyEntries:this.historyChanges.length, storageKB:kb, watchlistCount:this.watchlist.size, cloudSync: window._fb && currentUser ? '☁️ Firebase' : '💾 Local' }; }
}

// ==================== UI RENDERER ====================
class UIRenderer {
    constructor(app) {
        this.app = app; this.filters = { client:'all', country:'all', status:'all', search:'' }; this.sort={col:'diasDesconexion',dir:'desc'}; this.currentView='groups'; this.selectedRows=new Set(); this._searchTimer=null; this.charts={};
        this._setupEvents(); app.subscribe(()=>{ this._updateDropdowns(); this.render(); this._updateWatchlist(); });
    }
    _setupEvents() {
        // Filtros monitor
        document.getElementById('searchInput')?.addEventListener('input',e=>{ clearTimeout(this._searchTimer); this._searchTimer=setTimeout(()=>{ this.filters.search=e.target.value; this.render(); },CFG.DEBOUNCE); });
        document.getElementById('clientFilter')?.addEventListener('change',e=>{ this.filters.client=e.target.value; this.render(); });
        document.getElementById('countryFilter')?.addEventListener('change',e=>{ this.filters.country=e.target.value; this.render(); });
        document.getElementById('statusFilter')?.addEventListener('change',e=>{ this.filters.status=e.target.value; this.render(); });
        document.getElementById('clearFiltersBtn')?.addEventListener('click',()=>{ this.filters={client:'all',country:'all',status:'all',search:''}; document.getElementById('searchInput').value=''; document.getElementById('clientFilter').value='all'; document.getElementById('countryFilter').value='all'; document.getElementById('statusFilter').value='all'; this.render(); });
        document.getElementById('refreshBtn')?.addEventListener('click',()=>{ this.render(); Toast.show('Vista actualizada','success'); });
        document.querySelectorAll('.view-btn').forEach(btn=>{ btn.addEventListener('click',()=>{ document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); this.currentView=btn.dataset.view; this.selectedRows.clear(); this.render(); }); });
        document.getElementById('metricsGrid')?.addEventListener('click',e=>{ let card=e.target.closest('.metric-card[data-filter]'); if(card){ let f=card.dataset.filter; document.getElementById('statusFilter').value=f; this.filters.status=f; this.render(); } });
        document.getElementById('devicesTable')?.querySelectorAll('th[data-sort]').forEach(th=>{ th.addEventListener('click',()=>{ let col=th.dataset.sort; if(this.sort.col===col) this.sort.dir=this.sort.dir==='asc'?'desc':'asc'; else{ this.sort.col=col; this.sort.dir='asc'; } this.render(); }); });
        document.getElementById('selectAllCheck')?.addEventListener('change',e=>{ let allIds=this._getFilteredDevices().map(d=>d.id); if(e.target.checked) allIds.forEach(id=>this.selectedRows.add(id)); else this.selectedRows.clear(); this._renderBulkBar(); this._refreshRowSelection(); });
        document.getElementById('bulkConnectBtn')?.addEventListener('click',()=>{ if(this.selectedRows.size) this.app.bulkStatusChange([...this.selectedRows],'connected'); this.selectedRows.clear(); });
        document.getElementById('bulkDisconnectBtn')?.addEventListener('click',()=>{ if(this.selectedRows.size) this.app.bulkStatusChange([...this.selectedRows],'disconnected'); this.selectedRows.clear(); });
        
        // ========== MENÚ LATERAL CORREGIDO (FUNCIONAL Y ROBUSTO) ==========
        const menuItems = document.querySelectorAll('.sidebar-item');
        const panes = document.querySelectorAll('.tab-pane');
        
        // Función para cambiar de pestaña
        const switchToTab = (tabId) => {
            console.log(`Cambiando a pestaña: ${tabId}`); // Depuración
            // Bloqueo de acceso por rol antes de renderizar contenido sensible
            if (!hasTabAccess(tabId)) {
                Toast.show('⛔ No tienes permiso para acceder a este módulo', 'warning');
                return;
            }
            // Ocultar todos los paneles
            panes.forEach(pane => pane.classList.remove('active'));
            // Mostrar el panel seleccionado
            const activePane = document.getElementById(tabId);
            if (activePane) {
                activePane.classList.add('active');
                console.log(`Panel ${tabId} activado`);
            } else {
                console.error(`Panel ${tabId} no encontrado`);
            }
            // Actualizar clases activas en el menú
            menuItems.forEach(item => {
                if (item.dataset.tab === tabId) item.classList.add('active');
                else item.classList.remove('active');
            });
            // Acciones específicas según el panel (forzar actualización de contenido)
            if (tabId === 'charts') {
                setTimeout(() => this._updateCharts(), 100);
            } else if (tabId === 'history') {
                updateHistoryDisplay();
            } else if (tabId === 'support') {
                updateSupportDeviceSelect();
                // Si hay un dispositivo seleccionado previamente, mostrar sus tickets
                const sel = document.getElementById('supportDeviceSelect');
                if (sel && sel.value) displaySupportForDevice(sel.value);
            } else if (tabId === 'backup') {
                this._updateStorageInfo();
            } else if (tabId === 'assistant') {
                this._updateAiFacts();
                this._ensureAiWelcome();
            } else if (tabId === 'users' && currentUser?.isAdmin) {
                loadUserListUI();
            }
        };
        
        // Asignar evento click a cada elemento del menú (eliminar listeners previos para evitar duplicados)
        menuItems.forEach(item => {
            // Remover cualquier listener anterior (por si acaso)
            item.removeEventListener('click', item._clickHandler);
            // Crear nuevo handler
            const handler = (e) => {
                e.preventDefault();
                const tab = item.dataset.tab;
                if (tab) switchToTab(tab);
            };
            item.addEventListener('click', handler);
            item._clickHandler = handler; // guardar referencia para posible remoción
        });
        
        // Soporte: filtro automático por estado
        document.getElementById('ticketStatusFilter')?.addEventListener('change', () => applyAllTicketFilters());
        document.getElementById('supportClientFilter')?.addEventListener('change', updateSupportDeviceSelect);
        document.getElementById('chartClientFilter')?.addEventListener('change',()=>this._updateCharts());
        document.getElementById('applyTicketFilters')?.addEventListener('click', applyAllTicketFilters);
document.getElementById('clearTicketFilters')?.addEventListener('click', clearTicketFilters);

// Búsqueda instantánea con debounce en texto libre
let _ticketSearchTimer = null;
document.getElementById('ticketFreeSearch')?.addEventListener('input', () => {
    clearTimeout(_ticketSearchTimer);
    _ticketSearchTimer = setTimeout(applyAllTicketFilters, 280);
});
// Aplicar filtros al cambiar cualquier selector
['supportClientFilter','ticketStatusFilter','ticketTypeFilter','ticketTechFilter','ticketDateFrom','ticketDateTo'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', applyAllTicketFilters);
});
        document.getElementById('applyHistoryFilters')?.addEventListener('click', () => updateHistoryDisplay());
        document.getElementById('searchTicketBtn')?.addEventListener('click',()=>{ let val=document.getElementById('ticketSearchInput').value.trim(); if(val){ let n=parseInt(val); if(!isNaN(n)) showTicketDetail(n); } });
        document.getElementById('clearTicketSearch')?.addEventListener('click',()=>{ document.getElementById('ticketSearchInput').value=''; document.getElementById('ticketStatusFilter').value='all'; document.getElementById('supportContent').innerHTML='<div class="empty-state"><div class="icon">🔧</div><p>Selecciona un dispositivo</p></div>'; });
        document.getElementById('themeToggle')?.addEventListener('click',()=>{ document.body.classList.toggle('light-mode'); let isLight=document.body.classList.contains('light-mode'); document.getElementById('themeToggle').textContent=isLight?'🌑 Oscuro':'🌙 Oscuro'; localStorage.setItem('nm_theme',isLight?'light':'dark'); setTimeout(()=>this._updateCharts(),100); });
        if(localStorage.getItem('nm_theme')==='light'){ document.body.classList.add('light-mode'); document.getElementById('themeToggle').textContent='🌑 Oscuro'; }
        document.getElementById('csvUpload')?.addEventListener('change',async e=>{ if(e.target.files.length){ await this.app.loadCSV([...e.target.files]); e.target.value=''; } });
        document.body.addEventListener('dragover',e=>{ e.preventDefault(); document.body.classList.add('dragging'); });
        document.body.addEventListener('dragleave',e=>{ if(!e.relatedTarget) document.body.classList.remove('dragging'); });
        document.body.addEventListener('drop',async e=>{ e.preventDefault(); document.body.classList.remove('dragging'); let files=[...e.dataTransfer.files].filter(f=>f.name.endsWith('.csv')); if(files.length){ await this.app.loadCSV(files); Toast.show(`${files.length} archivo(s) CSV cargados`,'success'); } });
        document.getElementById('exportReportBtn')?.addEventListener('click',()=>{ document.getElementById('exportModal').classList.add('active'); this._updateExportDropdown(); });
        document.getElementById('doExportBtn')?.addEventListener('click',()=>exportReport());
        document.getElementById('applyManualStatusBtn')?.addEventListener('click',applyManualStatus);
        document.getElementById('supportForm')?.addEventListener('submit',e=>{ e.preventDefault(); if(!window._currentSupportDevice) return; let device = _app.devices.get(window._currentSupportDevice); let deviceName = device ? device.nombre : 'Desconocido'; let ticket={ date:document.getElementById('supportDate').value, type:document.getElementById('supportType').value, technician:document.getElementById('supportTechnician').value, description:document.getElementById('supportDescription').value, result:document.getElementById('supportResult').value, deviceName: deviceName }; let num=this.app.addSupport(window._currentSupportDevice,ticket); closeModal('supportModal'); Toast.show(`✅ Ticket #${num} registrado`,'success'); displaySupportForDevice(window._currentSupportDevice); this._updateCharts(); });
        document.addEventListener('keydown',e=>{ if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return; if(e.key==='/'){ e.preventDefault(); document.getElementById('searchInput')?.focus(); } if(e.key==='1') document.querySelector('.sidebar-item[data-tab="monitor"]')?.click(); if(e.key==='2') document.querySelector('.sidebar-item[data-tab="support"]')?.click(); if(e.key==='3') document.querySelector('.sidebar-item[data-tab="history"]')?.click(); if(e.key==='4') document.querySelector('.sidebar-item[data-tab="charts"]')?.click(); if(e.key==='Escape') document.getElementById('clearFiltersBtn')?.click(); if(e.key==='?') document.getElementById('kbdHint')?.classList.toggle('show'); });
        document.getElementById('kbdBtn')?.addEventListener('click',()=>document.getElementById('kbdHint')?.classList.toggle('show'));
        document.getElementById('exportBackupBtn')?.addEventListener('click',()=>{ let json=this.app.exportBackup(); let blob=new Blob([json],{type:'application/json'}); let a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`neomedia_backup_${nmTimestamp()}.json`; a.click(); URL.revokeObjectURL(a.href); Toast.show('Backup exportado','success'); });
        document.getElementById('syncFromCloudBtn')?.addEventListener('click', () => forceSyncFromCloud());
        document.getElementById('importBackupFile')?.addEventListener('change',async e=>{ let file=e.target.files[0]; if(!file) return; if(!confirm('¿Reemplazar todos los datos actuales con este backup?')){ e.target.value=''; return; } try{ let text=await this.app._readFile(file); this.app.importBackup(text); Toast.show('Backup importado correctamente','success'); } catch(err){ Toast.show('Error al importar backup: '+err.message,'error'); } e.target.value=''; });
        document.getElementById('clearAllDataBtn')?.addEventListener('click',()=>{ if(confirm('¿Borrar TODOS los datos? Esta acción es irreversible.')) this.app.clearAll(); });
        document.getElementById('autoRefreshSelect')?.addEventListener('change',e=>startAutoRefresh(parseInt(e.target.value)));
        const openAssistant = () => {
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            document.getElementById('assistant')?.classList.add('active');
            document.querySelectorAll('.sidebar-item').forEach(item => item.classList.toggle('active', item.dataset.tab === 'assistant'));
            this._updateAiFacts();
            this._ensureAiWelcome();
        };
        window.openAssistantTab = openAssistant;
        document.getElementById('openAssistantFromAttention')?.addEventListener('click',openAssistant);
        document.getElementById('assistantHeaderBtn')?.addEventListener('click',openAssistant);
        document.getElementById('aiAskBtn')?.addEventListener('click',()=>this._askAssistant());
        document.getElementById('aiInput')?.addEventListener('keydown',e=>{ if(e.key==='Enter') this._askAssistant(); });
        document.getElementById('aiDailyBriefBtn')?.addEventListener('click',()=>this._askAssistant('Genera un reporte ejecutivo'));
        document.querySelectorAll('.ai-chip').forEach(btn=>btn.addEventListener('click',()=>this._askAssistant(btn.dataset.prompt)));
        document.getElementById('aiChat')?.addEventListener('click',e=>{
            const btn = e.target.closest('.ai-action-btn');
            if(btn) this._runAiAction(btn.dataset.action);
        });
    }
    _getFilteredDevices() { let devs=this.app.getDevices(); if(this.filters.client!=='all') devs=devs.filter(d=>d.cliente===this.filters.client); if(this.filters.country!=='all') devs=devs.filter(d=>d.pais===this.filters.country); if(this.filters.status!=='all') devs=devs.filter(d=>d.alertLevel===this.filters.status); if(this.filters.search){ let s=this.filters.search.toLowerCase(); devs=devs.filter(d=>d.nombre.toLowerCase().includes(s)||d.ip.includes(s)||(d.ubicacion||'').toLowerCase().includes(s)||d.cliente.toLowerCase().includes(s)); } return devs; }
    render() { let devs=this._getFilteredDevices(); this._renderMetrics(devs); this._renderAttentionPanel(); this._updateAiFacts(); document.getElementById('resultsCount').textContent=`${devs.length} dispositivos`; this._renderActiveFilters(); if(this.currentView==='groups'){ document.getElementById('groupsView').style.display='grid'; document.getElementById('tableView').style.display='none'; this._renderGroups(devs); }else{ document.getElementById('groupsView').style.display='none'; document.getElementById('tableView').style.display='block'; this._renderTable(this._sortDevices(devs)); } }
    _collectOpsInsights() {
        const devs = this.app.getDevices();
        const tickets = this.app.getAllSupports();
        const openTickets = tickets.filter(t => t.result !== 'resuelto');
        const overdueTickets = openTickets.filter(t => {
            const ts = t.createdAt || t.date;
            if(!ts) return false;
            return (Date.now() - new Date(ts).getTime()) / 3600000 >= 72;
        });
        const critical = devs.filter(d => d.alertLevel === 'critical').sort((a,b)=>(b.diasDesconexion||0)-(a.diasDesconexion||0));
        const warning = devs.filter(d => d.alertLevel === 'warning');
        const connected = devs.filter(d => d.alertLevel === 'connected');
        const byClient = {};
        devs.forEach(d => {
            byClient[d.cliente] ??= { total:0, critical:0, warning:0, disconnected:0, connected:0 };
            byClient[d.cliente].total++;
            byClient[d.cliente][d.alertLevel] = (byClient[d.cliente][d.alertLevel] || 0) + 1;
        });
        const riskyClients = Object.entries(byClient)
            .map(([client, s]) => ({ client, ...s, risk: s.critical * 3 + s.warning * 2 + s.disconnected }))
            .sort((a,b)=>b.risk-a.risk);
        const ticketByClient = {};
        tickets.forEach(t => {
            const d = this.app.devices.get(t.deviceId) || this.app.baseDevices.get(t.deviceId);
            const client = d?.cliente || 'Sin cliente';
            ticketByClient[client] = (ticketByClient[client] || 0) + 1;
        });
        return { devs, tickets, openTickets, overdueTickets, critical, warning, connected, byClient, riskyClients, ticketByClient };
    }
    _renderAttentionPanel() {
        const grid = document.getElementById('attentionGrid');
        if(!grid) return;
        const s = this._collectOpsInsights();
        if(!s.devs.length) {
            grid.innerHTML = `<div class="attention-item"><div class="attention-item-title">Importa datos para comenzar</div><div class="attention-item-body">Carga uno o varios CSV para activar prioridades, asistente IA y reportes automáticos.</div></div>`;
            return;
        }
        const topClient = s.riskyClients[0];
        const topCritical = s.critical[0];
        const items = [];
        items.push({
            cls: s.critical.length ? 'high' : 'good',
            title: s.critical.length ? `${s.critical.length} dispositivos críticos` : 'Sin críticos activos',
            body: s.critical.length ? `Prioriza ${this._esc(topCritical?.nombre)} de ${this._esc(topCritical?.cliente)} con ${(topCritical?.diasDesconexion||0).toFixed(1)} días offline.` : 'La operación no muestra equipos con más de 7 días offline.',
            tab: 'monitor',
            filter: 'critical'
        });
        items.push({
            cls: s.overdueTickets.length ? 'high' : (s.openTickets.length ? 'medium' : 'good'),
            title: `${s.openTickets.length} tickets abiertos`,
            body: s.overdueTickets.length ? `${s.overdueTickets.length} superan 72h. Conviene revisar SLA y escalar responsables.` : (s.openTickets.length ? 'Hay tickets pendientes dentro del umbral operativo.' : 'No hay tickets abiertos pendientes de gestión.'),
            tab: 'support'
        });
        items.push({
            cls: topClient?.risk ? 'medium' : 'good',
            title: topClient?.risk ? `Cliente con más riesgo: ${this._esc(topClient.client)}` : 'Clientes estables',
            body: topClient?.risk ? `${topClient.critical} críticos, ${topClient.warning} en alerta y ${topClient.disconnected} desconectados.` : 'No se detecta concentración de incidentes por cliente.',
            tab: 'assistant'
        });
        items.push({
            cls: 'good',
            title: `${Math.round((s.connected.length / Math.max(s.devs.length,1)) * 100)}% conectividad`,
            body: `${s.connected.length} de ${s.devs.length} dispositivos están conectados. Revisa tendencias desde Gráficos.`,
            tab: 'charts'
        });
        grid.innerHTML = items.map(i => `<div class="attention-item ${i.cls}" data-tab="${i.tab}" data-filter="${i.filter||''}"><div class="attention-item-title">${i.title}</div><div class="attention-item-body">${i.body}</div></div>`).join('');
        grid.querySelectorAll('.attention-item').forEach(el => el.addEventListener('click', () => {
            if(el.dataset.filter){ this.filters.status = el.dataset.filter; document.getElementById('statusFilter').value = el.dataset.filter; this.render(); }
            document.querySelector(`.sidebar-item[data-tab="${el.dataset.tab}"]`)?.click();
        }));
    }
    _updateAiFacts() {
        const el = document.getElementById('aiFacts');
        if(!el) return;
        const s = this._collectOpsInsights();
        const connPct = Math.round((s.connected.length / Math.max(s.devs.length,1)) * 100);
        const top = s.riskyClients[0]?.client || 'Sin datos';
        el.innerHTML = [
            ['Dispositivos', s.devs.length],
            ['Conectividad', `${connPct}%`],
            ['Críticos', s.critical.length],
            ['Alertas', s.warning.length],
            ['Tickets abiertos', s.openTickets.length],
            ['Tickets >72h', s.overdueTickets.length],
            ['Cliente foco', this._esc(top)]
        ].map(([k,v])=>`<div class="ai-fact"><span>${k}</span><strong>${v}</strong></div>`).join('');
    }
    _ensureAiWelcome() {
        const chat = document.getElementById('aiChat');
        if(!chat || chat.dataset.ready) return;
        chat.dataset.ready = 'true';
        this._addAiMessage('bot', 'Estoy listo para ayudarte con prioridades, tickets, clientes críticos y reportes ejecutivos usando los datos cargados en este dashboard.', [
            {label:'Ver críticos', action:'filter-critical'},
            {label:'Tickets pendientes', action:'show-open-tickets'},
            {label:'Crear ticket sugerido', action:'create-ticket-top'}
        ]);
    }
    _addAiMessage(type, text, actions=[]) {
        const chat = document.getElementById('aiChat');
        if(!chat) return;
        const msg = document.createElement('div');
        msg.className = `ai-msg ${type}`;
        msg.textContent = text;
        if(actions.length) {
            const row = document.createElement('div');
            row.className = 'ai-actions';
            row.innerHTML = actions.map(a=>`<button class="ai-action-btn" data-action="${this._esc(a.action)}">${this._esc(a.label)}</button>`).join('');
            msg.appendChild(row);
        }
        chat.appendChild(msg);
        chat.scrollTop = chat.scrollHeight;
    }
    async _askAssistant(forcedPrompt) {
        const input = document.getElementById('aiInput');
        const prompt = (forcedPrompt || input?.value || '').trim();
        if(!prompt) return;
        this._ensureAiWelcome();
        this._addAiMessage('user', prompt);
        if(input) input.value = '';
        const answer = await this._buildAiAnswer(prompt);
        if(typeof answer === 'string') this._addAiMessage('bot', answer);
        else this._addAiMessage('bot', answer.text, answer.actions || []);
    }
    _aiPayload(prompt) {
        const s = this._collectOpsInsights();
        return {
            prompt,
            metrics: {
                devices: s.devs.length,
                connected: s.connected.length,
                warning: s.warning.length,
                critical: s.critical.length,
                openTickets: s.openTickets.length,
                overdueTickets: s.overdueTickets.length
            },
            riskyClients: s.riskyClients.slice(0, 10),
            criticalDevices: s.critical.slice(0, 20).map(d => ({
                id: d.id, nombre: d.nombre, cliente: d.cliente, pais: d.pais,
                diasDesconexion: d.diasDesconexion, ultimoAcceso: d.ultimoAcceso, ip: d.ip
            })),
            openTickets: s.openTickets.slice(0, 20).map(t => ({
                ticketNumber: t.ticketNumber, deviceId: t.deviceId, deviceName: t.deviceName,
                date: t.date, result: t.result, technician: t.technician, type: t.type,
                description: t.description
            }))
        };
    }
    async _askRemoteAi(prompt) {
        const endpoint = localStorage.getItem('nm_ai_endpoint') || '/api/ai';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this._aiPayload(prompt))
        });
        if(!res.ok) throw new Error(`IA HTTP ${res.status}`);
        const data = await res.json();
        return data.answer || data.text || '';
    }
    _runAiAction(action) {
        if(!action) return;
        if(action === 'filter-critical') {
            this.filters.status = 'critical';
            const status = document.getElementById('statusFilter');
            if(status) status.value = 'critical';
            document.querySelector('.sidebar-item[data-tab="monitor"]')?.click();
            this.render();
            return;
        }
        if(action === 'show-open-tickets') {
            document.querySelector('.sidebar-item[data-tab="support"]')?.click();
            const status = document.getElementById('ticketStatusFilter');
            if(status) status.value = 'pendiente';
            applyAllTicketFilters();
            return;
        }
        if(action === 'create-ticket-top') {
            const top = this._collectOpsInsights().critical[0] || this.app.getDevices().find(d=>d.alertLevel !== 'connected') || this.app.getDevices()[0];
            if(!top) { Toast.show('No hay dispositivos para crear ticket', 'warning'); return; }
            this._openAiTicket(top.id);
            return;
        }
        if(action.startsWith('create-ticket:')) {
            this._openAiTicket(decodeURIComponent(action.split(':').slice(1).join(':')));
            return;
        }
        if(action.startsWith('client-report:')) {
            const client = decodeURIComponent(action.split(':').slice(1).join(':'));
            this._addAiMessage('bot', this._clientReport(client), [
                {label:'Exportar reporte', action:`export-client-report:${encodeURIComponent(client)}`},
                {label:'Filtrar cliente', action:`filter-client:${encodeURIComponent(client)}`}
            ]);
            return;
        }
        if(action.startsWith('export-client-report:')) {
            this._downloadClientReport(decodeURIComponent(action.split(':').slice(1).join(':')));
            return;
        }
        if(action.startsWith('filter-client:')) {
            const client = decodeURIComponent(action.split(':').slice(1).join(':'));
            this.filters.client = client;
            const sel = document.getElementById('clientFilter');
            if(sel) sel.value = client;
            document.querySelector('.sidebar-item[data-tab="monitor"]')?.click();
            this.render();
        }
    }
    _openAiTicket(deviceId) {
        const d = this.app.devices.get(deviceId);
        if(!d) { Toast.show('Dispositivo no encontrado', 'warning'); return; }
        openSupportModal(deviceId);
        const desc = `Ticket sugerido por Asistente IA.\n\nDispositivo ${d.nombre} de ${d.cliente} figura como ${d.alertLevel}. Último acceso: ${d.ultimoAcceso || 'sin dato'}. Días offline: ${d.diasDesconexion != null ? d.diasDesconexion.toFixed(1) : 'N/A'}.\n\nPasos recomendados:\n1. Validar conectividad/IP/VPN.\n2. Confirmar energía y estado físico del player.\n3. Revisar si existen tickets previos relacionados.\n4. Escalar si supera el SLA operativo.`;
        document.getElementById('supportType').value = 'conectividad';
        document.getElementById('supportTechnician').value = currentUser?.email || '';
        document.getElementById('supportDescription').value = desc;
        document.getElementById('supportSolution').value = 'Pendiente de diagnóstico.';
        document.getElementById('supportResult').value = 'pendiente';
    }
    _clientReport(client) {
        const devs = this.app.getDevices().filter(d=>d.cliente === client);
        const ids = new Set(devs.map(d=>d.id));
        const tickets = this.app.getAllSupports().filter(t=>ids.has(t.deviceId));
        const open = tickets.filter(t=>t.result !== 'resuelto');
        const critical = devs.filter(d=>d.alertLevel === 'critical').sort((a,b)=>(b.diasDesconexion||0)-(a.diasDesconexion||0));
        const warning = devs.filter(d=>d.alertLevel === 'warning');
        const connected = devs.filter(d=>d.alertLevel === 'connected');
        const top = critical.slice(0,5).map(d=>`- ${d.nombre}: ${(d.diasDesconexion||0).toFixed(1)} días offline (${d.pais})`).join('\n') || '- Sin críticos activos.';
        return `Reporte por cliente: ${client}\n\n- Dispositivos: ${devs.length}\n- Conectados: ${connected.length}\n- En alerta: ${warning.length}\n- Críticos: ${critical.length}\n- Tickets totales: ${tickets.length}\n- Tickets abiertos: ${open.length}\n\nPrioridad:\n${top}\n\nAcción recomendada: revisar primero los críticos, confirmar si tienen ticket abierto y cerrar la brecha de documentación en soporte.`;
    }
    _downloadClientReport(client) {
        const report = this._esc(this._clientReport(client)).replace(/\n/g,'<br>');
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte ${this._esc(client)}</title><style>body{font-family:Arial,sans-serif;padding:24px;line-height:1.5}h1{color:#111827}</style></head><body><h1>NEOMEDIA DIGITAL - Reporte Cliente</h1><p>${report}</p></body></html>`;
        _download(html, `reporte_cliente_${client.replace(/[^a-z0-9]+/gi,'_')}_${nmTimestamp()}.html`, 'text/html;charset=utf-8');
        Toast.show('Reporte de cliente exportado', 'success');
    }
    async _buildAiAnswer(prompt) {
        const s = this._collectOpsInsights();
        const q = prompt.toLowerCase();
        if(!s.devs.length) return 'Aún no hay dispositivos cargados. Importa un CSV y podré priorizar críticos, tickets, clientes con riesgo y generar reportes.';
        if(localStorage.getItem('nm_ai_enabled') === 'true') {
            try {
                const remote = await this._askRemoteAi(prompt);
                if(remote) return remote;
            } catch(e) {
                console.warn('IA remota no disponible; usando asistente local:', e);
                Toast.show('IA remota no disponible. Usando análisis local.', 'warning', 3500);
            }
        }
        const topClients = s.riskyClients.filter(c=>c.risk>0).slice(0,5).map(c=>`- ${c.client}: ${c.critical} críticos, ${c.warning} alertas, ${c.disconnected} desconectados`).join('\n') || '- No hay clientes con riesgo operativo visible.';
        const topCritical = s.critical.slice(0,5).map(d=>`- ${d.nombre} (${d.cliente}, ${d.pais}): ${(d.diasDesconexion||0).toFixed(1)} días offline`).join('\n') || '- No hay dispositivos críticos.';
        const overdue = s.overdueTickets.slice(0,5).map(t=>`- Ticket #${t.ticketNumber}: ${t.deviceName||'Dispositivo'} · ${t.result} · ${t.technician||'sin técnico'}`).join('\n') || '- No hay tickets vencidos por encima de 72h.';
        const actions = [
            {label:'Filtrar críticos', action:'filter-critical'},
            {label:'Tickets pendientes', action:'show-open-tickets'},
            {label:'Crear ticket sugerido', action:'create-ticket-top'}
        ];
        const clientActions = s.riskyClients.filter(c=>c.risk>0).slice(0,3).map(c=>({label:`Reporte ${c.client.slice(0,18)}`, action:`client-report:${encodeURIComponent(c.client)}`}));
        if(q.includes('ticket') || q.includes('pendiente') || q.includes('vencid')) {
            return { text:`Tickets abiertos: ${s.openTickets.length}\nTickets con más de 72h: ${s.overdueTickets.length}\n\nPrioridad:\n${overdue}`, actions:[actions[1], actions[2]] };
        }
        if(q.includes('cliente') || q.includes('crítico') || q.includes('critico')) {
            return { text:`Riesgo por cliente:\n${topClients}\n\nDispositivos críticos principales:\n${topCritical}`, actions:[actions[0], actions[2], ...clientActions] };
        }
        if(q.includes('reporte') || q.includes('resumen') || q.includes('ejecutivo')) {
            const connPct = Math.round((s.connected.length / Math.max(s.devs.length,1)) * 100);
            return { text:`Resumen ejecutivo\n\n- Dispositivos monitoreados: ${s.devs.length}\n- Conectividad actual: ${connPct}%\n- Críticos: ${s.critical.length}\n- En alerta: ${s.warning.length}\n- Tickets abiertos: ${s.openTickets.length}\n- Tickets vencidos >72h: ${s.overdueTickets.length}\n\nFoco recomendado:\n${topClients}\n\nAcción sugerida: revisar primero críticos de clientes con mayor concentración y cerrar o escalar tickets vencidos.`, actions:[...actions, ...clientActions] };
        }
        return { text:`Atención hoy\n\n1. Revisar críticos:\n${topCritical}\n\n2. Revisar tickets vencidos:\n${overdue}\n\n3. Cliente foco:\n${topClients}`, actions:[...actions, ...clientActions] };
    }
    _sortDevices(devs) { return [...devs].sort((a,b)=>{ let av=a[this.sort.col], bv=b[this.sort.col]; if(av===null||av===undefined) av=-Infinity; if(bv===null||bv===undefined) bv=-Infinity; if(typeof av==='string') return this.sort.dir==='asc'?av.localeCompare(bv):bv.localeCompare(av); return this.sort.dir==='asc'?av-bv:bv-av; }); }
    _renderMetrics(devs) { let total=devs.length, conn=devs.filter(d=>d.alertLevel==='connected').length, warn=devs.filter(d=>d.alertLevel==='warning').length, crit=devs.filter(d=>d.alertLevel==='critical').length, disc=devs.filter(d=>d.alertLevel==='disconnected').length; let pct=total?Math.round(conn/total*100):0; let cur=this.filters.status; let html=`<div class="metric-card m-total${cur==='all'?' active-filter':''}" data-filter="all"><div class="metric-title">📊 TOTAL</div><div class="metric-value" style="color:#60a5fa">${total}</div><div class="metric-bar"><div class="metric-bar-fill" style="width:100%;background:#60a5fa"></div></div><div class="metric-trend">dispositivos</div></div><div class="metric-card m-connected${cur==='connected'?' active-filter':''}" data-filter="connected"><div class="metric-title">✅ CONECTADOS</div><div class="metric-value" style="color:var(--success)">${conn}</div><div class="metric-bar"><div class="metric-bar-fill" style="width:${pct}%;background:var(--success)"></div></div><div class="metric-trend">${pct}% conectado</div></div><div class="metric-card m-warning${cur==='warning'?' active-filter':''}" data-filter="warning"><div class="metric-title">🟡 ALERTA</div><div class="metric-value" style="color:var(--warning)">${warn}</div><div class="metric-bar"><div class="metric-bar-fill" style="width:${total?Math.round(warn/total*100):0}%;background:var(--warning)"></div></div><div class="metric-trend">48h – 7 días</div></div><div class="metric-card m-critical${cur==='critical'?' active-filter':''}" data-filter="critical"><div class="metric-title">🔴 CRÍTICOS</div><div class="metric-value" style="color:var(--danger)">${crit}</div><div class="metric-bar"><div class="metric-bar-fill" style="width:${total?Math.round(crit/total*100):0}%;background:var(--danger)"></div></div><div class="metric-trend">más de 7 días</div></div><div class="metric-card m-disconnected${cur==='disconnected'?' active-filter':''}" data-filter="disconnected"><div class="metric-title">⚪ DESCONECT.</div><div class="metric-value" style="color:var(--gray)">${disc}</div><div class="metric-bar"><div class="metric-bar-fill" style="width:${total?Math.round(disc/total*100):0}%;background:var(--gray)"></div></div><div class="metric-trend">menos de 48h</div></div>`; document.getElementById('metricsGrid').innerHTML=html; }
    _renderActiveFilters() { let tags=[]; if(this.filters.client!=='all') tags.push({label:`Cliente: ${this.filters.client}`, clear:()=>{ this.filters.client='all'; document.getElementById('clientFilter').value='all'; this.render(); }}); if(this.filters.country!=='all') tags.push({label:`País: ${this.filters.country}`, clear:()=>{ this.filters.country='all'; document.getElementById('countryFilter').value='all'; this.render(); }}); if(this.filters.status!=='all'){ let n={connected:'✅ Conectado',warning:'🟡 Alerta',critical:'🔴 Crítico',disconnected:'⚪ Desconect.'}; tags.push({label:n[this.filters.status]||this.filters.status, clear:()=>{ this.filters.status='all'; document.getElementById('statusFilter').value='all'; this.render(); }}); } if(this.filters.search) tags.push({label:`"${this.filters.search}"`, clear:()=>{ this.filters.search=''; document.getElementById('searchInput').value=''; this.render(); }}); let html=tags.map((t,i)=>`<div class="filter-tag">📌 ${this._esc(t.label)} <span class="remove" data-idx="${i}">✖</span></div>`).join(''); document.getElementById('activeFilters').innerHTML=html; document.querySelectorAll('.filter-tag .remove').forEach(el=>el.addEventListener('click',()=>tags[el.dataset.idx].clear())); }
    _renderGroups(devs) {
        const groups = {critical:[],warning:[],connected:[],disconnected:[]};
        devs.forEach(d => (groups[d.alertLevel] || groups.disconnected).push(d));
        const activeStatus = this.filters.status;

        // Actualizar contadores
        document.getElementById('criticalCount').textContent    = groups.critical.length;
        document.getElementById('warningCount').textContent     = groups.warning.length;
        document.getElementById('connectedCount').textContent   = groups.connected.length;
        document.getElementById('disconnectedCount').textContent= groups.disconnected.length;

        // Mapa de card-id → datos
        const cards = [
            {card:'criticalCard',    list:'criticalList',     key:'critical'},
            {card:'warningCard',     list:'warningList',      key:'warning'},
            {card:'connectedCard',   list:'connectedList',    key:'connected'},
            {card:'disconnectedCard',list:'disconnectedList', key:'disconnected'},
        ];

        for(const {card, list, key} of cards) {
            const cardEl = document.getElementById(card);
            if(!cardEl) continue;
            // Si hay filtro activo de estado, ocultar cards de otros estados
            if(activeStatus !== 'all' && activeStatus !== key) {
                cardEl.style.display = 'none';
            } else {
                cardEl.style.display = '';
                this._fillGroupList(list, groups[key]);
            }
        }

        // Si el filtro está activo, expandir el grid a 1 columna para mejor visibilidad
        const gv = document.getElementById('groupsView');
        if(gv) {
            gv.style.gridTemplateColumns = activeStatus !== 'all' ? '1fr' : '';
            gv.style.maxWidth = activeStatus !== 'all' ? '820px' : '';
        }
    }
    _fillGroupList(id,devs){ let el=document.getElementById(id); if(!devs.length){ el.innerHTML='<div class="empty-state" style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.75rem">Sin dispositivos</div>'; return; } el.innerHTML=devs.map(d=>{ let base=this.app.baseDevices.get(d.id); let savedName=(base&&base.nombre)||d.nombre; let did=safeIdForJs(d.id); let days=d.diasDesconexion!==null&&d.diasDesconexion>0?`<span style="color:var(--warning);font-weight:600">${d.diasDesconexion.toFixed(1)}d</span>`:'<span style="color:var(--success)">Online</span>'; let isWatched=this.app.watchlist.has(d.id); let openBadge=window._openTicketBadge?window._openTicketBadge(d.id):''; return `<div class="group-item" onclick="window.goToHistory(decodeSafeId('${did}'))"><div class="group-item-name" title="${this._esc(savedName)}">${this._esc(this._trunc(savedName,36))}</div><div class="group-item-meta"><span title="${this._esc(d.cliente)}">🏢 ${this._esc(this._trunc(d.cliente,18))}</span>${days}</div><div class="group-item-actions"><button class="micro-btn hist" onclick="event.stopPropagation();window.goToHistory(decodeSafeId('${did}'))">📜</button><button class="micro-btn sup" onclick="event.stopPropagation();window.goToSupport(decodeSafeId('${did}'))">🔧</button><button class="micro-btn conn" onclick="event.stopPropagation();window.openManualModal(decodeSafeId('${did}'))">🔌</button><button class="micro-btn watch" onclick="event.stopPropagation();window.toggleWatch(decodeSafeId('${did}'))">${isWatched?'★':'☆'}</button></div></div>`; }).join(''); }
    _renderTable(devs){ let tbody=document.getElementById('tableBody'); if(!devs.length){ tbody.innerHTML='<tr><td colspan="9" class="empty-state" style="padding:40px">📭 Sin dispositivos</td></tr>'; return; } let frag=document.createDocumentFragment(); for(let d of devs){ let badge={connected:`<span class="badge badge-connected"><span class="dot pulse"></span> Conectado</span>`, warning:`<span class="badge badge-warning"><span class="dot"></span> Alerta</span>`, critical:`<span class="badge badge-critical"><span class="dot"></span> Crítico</span>`, disconnected:`<span class="badge badge-disconnected"><span class="dot"></span> Desconect.</span>`}[d.alertLevel]||''; let offHtml='<span style="color:var(--text-muted)">N/A</span>'; if(d.diasDesconexion!==null){ let days=d.diasDesconexion; let w=Math.min(100,(days/60)*100); let cls=days>=7?'c':(days>=2?'m':'n'); let badge2=days>=7?'<span style="background:var(--danger-dim);color:var(--danger);padding:1px 6px;border-radius:10px;font-size:0.6rem;margin-left:4px">CRÍTICO</span>':(days>=2?'<span style="background:var(--warning-dim);color:var(--warning);padding:1px 6px;border-radius:10px;font-size:0.6rem;margin-left:4px">+48H</span>':''); offHtml=`<div class="offline-bar-bg"><div class="offline-bar-fill ${cls}" style="width:${w}%"></div></div><div class="offline-text">${days.toFixed(1)}d ${badge2}</div>`; } let isSel=this.selectedRows.has(d.id); let tr=document.createElement('tr'); if(isSel) tr.classList.add('row-selected'); let openBadge = window._openTicketBadge ? window._openTicketBadge(d.id) : '';
        let base2 = this.app.baseDevices.get(d.id);
        let savedNameT = (base2&&base2.nombre)||d.nombre;
        let did=safeIdForJs(d.id);
        tr.innerHTML=`<td><input type="checkbox" class="row-check" data-id="${this._esc(d.id)}" ${isSel?'checked':''}></td><td><strong>${this._esc(d.cliente)}</strong></td><td title="${this._esc(savedNameT)}"><div style="display:flex;align-items:center;gap:6px"><span style="font-family:var(--font-mono);font-size:0.82rem">${this._esc(this._trunc(savedNameT,38))}</span>${openBadge}</div></td><td style="white-space:nowrap">${this._esc(d.pais)}</td><td>${badge}</td><td style="font-size:0.8rem;color:var(--text-muted);font-family:var(--font-mono)">${this._esc(d.ultimoAcceso)}</td><td>${offHtml}</td><td style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted)">${this._esc(d.ip)}</td><td><div style="display:flex;gap:5px"><button class="micro-btn hist" onclick="window.goToHistory(decodeSafeId('${did}'))">📜</button><button class="micro-btn sup" onclick="window.goToSupport(decodeSafeId('${did}'))">🔧</button><button class="micro-btn conn" onclick="window.openManualModal(decodeSafeId('${did}'))">🔌</button><button class="micro-btn watch" onclick="window.toggleWatch(decodeSafeId('${did}'))">${this.app.watchlist.has(d.id)?'★':'☆'}</button></div></td>`; frag.appendChild(tr); } tbody.innerHTML=''; tbody.appendChild(frag); tbody.querySelectorAll('.row-check').forEach(cb=>{ cb.addEventListener('change',e=>{ if(e.target.checked) this.selectedRows.add(e.target.dataset.id); else this.selectedRows.delete(e.target.dataset.id); let tr=e.target.closest('tr'); if(tr) tr.classList.toggle('row-selected',e.target.checked); this._renderBulkBar(); }); }); }
    _renderBulkBar() { let bar=document.getElementById('bulkBar'); if(bar) bar.classList.toggle('visible',this.selectedRows.size>0); document.getElementById('bulkCount').textContent=`${this.selectedRows.size} seleccionados`; }
    _refreshRowSelection() { document.querySelectorAll('.row-check').forEach(cb=>cb.checked=this.selectedRows.has(cb.dataset.id)); }
    _updateWatchlist(){ let strip=document.getElementById('watchlistStrip'); let items=document.getElementById('watchlistItems'); if(!strip||!items) return; if(!this.app.watchlist.size){ strip.classList.remove('has-items'); return; } let dots={connected:'var(--success)', warning:'var(--warning)', critical:'var(--danger)', disconnected:'var(--gray)'}; items.innerHTML=[...this.app.watchlist].map(id=>{ let d=this.app.devices.get(id)||this.app.baseDevices.get(id); if(!d) return ''; let color=dots[d.alertLevel]||'var(--gray)'; let did=safeIdForJs(id); return `<div class="watchlist-chip" onclick="window.goToHistory(decodeSafeId('${did}'))"><span class="status-dot" style="background:${color}"></span><span>${this._esc(this._trunc(d.nombre||d.id,30))}</span><span class="remove-watch" onclick="event.stopPropagation();window.toggleWatch(decodeSafeId('${did}'))">✕</span></div>`; }).join(''); strip.classList.toggle('has-items',items.innerHTML.trim()!==''); }
    _updateDropdowns(){ let devs=this.app.getDevices(); let clients=[...new Set(devs.map(d=>d.cliente))]; clients.sort((a,b)=>{ let ia=CFG.KNOWN_CLIENTS.indexOf(a), ib=CFG.KNOWN_CLIENTS.indexOf(b); if(ia!==-1&&ib!==-1) return ia-ib; if(ia!==-1) return -1; if(ib!==-1) return 1; return a.localeCompare(b); }); let cOpts='<option value="all">Todos los clientes</option>'+clients.map(c=>`<option value="${this._esc(c)}">${this._esc(c)}</option>`).join(''); let countries=[...new Set(devs.map(d=>d.pais))]; let coOpts='<option value="all">Todos los países</option>'+countries.map(c=>`<option value="${this._esc(c)}">${this._esc(c)}</option>`).join(''); ['clientFilter','chartClientFilter','historyClientFilter','supportClientFilter','exportClientFilter'].forEach(id=>{ let el=document.getElementById(id); if(el){ let cur=el.value; el.innerHTML=cOpts; el.value=cur; } }); ['countryFilter'].forEach(id=>{ let el=document.getElementById(id); if(el){ let cur=el.value; el.innerHTML=coOpts; el.value=cur; } }); }
    _updateExportDropdown(){ this._updateDropdowns(); }
    _updateStorageInfo(){ let info=this.app.getStorageInfo(); document.getElementById('storageInfo').innerHTML=Object.entries({'Dispositivos activos':info.devices||0,'Dispositivos en base':info.baseDevices||0,'Tickets registrados':info.tickets||0,'Entradas de historial':info.historyEntries||0,'Watchlist':info.watchlistCount||0,'Uso de almacenamiento':`~${info.storageKB||0} KB`}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border-color);padding:4px 0"><span>${k}</span><strong>${v}</strong></div>`).join(''); }
    _updateCharts(){ if(!window.Chart){ console.warn('Chart.js no está disponible; se omiten gráficos.'); return; } let client=document.getElementById('chartClientFilter')?.value||'all'; let tickets=this.app.getAllSupports(); if(client!=='all'){ let filtered=[]; for(let [id,ts] of this.app.supports){ let d=this.app.devices.get(id); if(d&&d.cliente===client) filtered.push(...ts); } tickets=filtered.sort((a,b)=>b.ticketNumber-a.ticketNumber); } let devs=client==='all'?this.app.getDevices():this.app.getDevices().filter(d=>d.cliente===client); let isDark=!document.body.classList.contains('light-mode'); let textColor=isDark?'#7a869e':'#475569'; let gridColor=isDark?'#1e2535':'#e2e8f0'; let defs=[{id:'ticketTypeChart',type:'pie',colors:['#00e5ff','#00e5a0','#ffb347','#ff4d6d','#c084fc','#f472b6','#556070'],compute:()=>{let m={}; tickets.forEach(t=>m[t.type]=(m[t.type]||0)+1); let n={preventivo:'🛡️ Prev.',correctivo:'🔧 Correct.',configuracion:'⚙️ Config.',conectividad:'🌐 Conectiv.',hardware:'💻 HW',software:'📱 SW',otro:'📝 Otro'}; return{labels:Object.keys(m).map(k=>n[k]||k),data:Object.values(m)};}},{id:'ticketResultChart',type:'doughnut',colors:['#00e5a0','#ffb347','#ff4d6d','#556070'],compute:()=>{let m={resuelto:0,parcial:0,no_resuelto:0,pendiente:0}; tickets.forEach(t=>m[t.result]=(m[t.result]||0)+1); return{labels:['✅ Resuelto','⚠️ Parcial','❌ No resuelto','⏳ Pendiente'],data:[m.resuelto,m.parcial,m.no_resuelto,m.pendiente]};}},{id:'technicianChart',type:'bar',color:'#00e5ff',compute:()=>{let m={}; tickets.forEach(t=>m[t.technician]=(m[t.technician]||0)+1); let top=Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,6); return{labels:top.map(t=>t[0]),data:top.map(t=>t[1])};}},{id:'ticketsByMonthChart',type:'line',color:'#00e5a0',compute:()=>{let m={}; tickets.forEach(t=>{let k=t.date.substring(0,7); m[k]=(m[k]||0)+1;}); let keys=Object.keys(m).sort(); return{labels:keys,data:keys.map(k=>m[k])};}},{id:'devicesByCountryChart',type:'bar',color:'#ffb347',compute:()=>{let m={}; devs.forEach(d=>m[d.pais]=(m[d.pais]||0)+1); let e=Object.entries(m).sort((a,b)=>b[1]-a[1]); return{labels:e.map(x=>x[0]),data:e.map(x=>x[1])};}},{id:'statusByClientChart',type:'bar',compute:()=>{let clients=[...new Set(devs.map(d=>d.cliente))].sort(); let conn=clients.map(c=>devs.filter(d=>d.cliente===c&&d.alertLevel==='connected').length); let warn=clients.map(c=>devs.filter(d=>d.cliente===c&&d.alertLevel==='warning').length); let crit=clients.map(c=>devs.filter(d=>d.cliente===c&&d.alertLevel==='critical').length); return{labels:clients,datasets:[{label:'✅ Conectado',data:conn,backgroundColor:'#00e5a0'},{label:'🟡 Alerta',data:warn,backgroundColor:'#ffb347'},{label:'🔴 Crítico',data:crit,backgroundColor:'#ff4d6d'}]};}}]; for(let def of defs){ if(this.charts[def.id]){ this.charts[def.id].destroy(); delete this.charts[def.id]; } let c=document.getElementById(def.id); if(!c) continue; let {labels,data,datasets}=def.compute(); let chartDatasets; if(datasets) chartDatasets=datasets; else if(def.type==='bar'||def.type==='line') chartDatasets=[{label:'Total',data,backgroundColor:def.color,borderColor:def.color,tension:0.3,fill:def.type==='line'}]; else chartDatasets=[{data,backgroundColor:def.colors||['#00e5ff','#00e5a0','#ffb347','#ff4d6d']}]; let opts={responsive:true,plugins:{legend:{labels:{color:textColor,font:{size:11}}}}}; if(def.type==='bar'||def.type==='line') opts.scales={x:{ticks:{color:textColor,font:{size:11}},grid:{color:gridColor}},y:{ticks:{color:textColor,font:{size:11}},grid:{color:gridColor},beginAtZero:true}}; if(datasets) opts.scales={x:{ticks:{color:textColor,font:{size:11}},grid:{color:gridColor},stacked:true},y:{ticks:{color:textColor,font:{size:11}},grid:{color:gridColor},beginAtZero:true,stacked:true}}; this.charts[def.id]=new Chart(c.getContext('2d'),{type:def.type,data:{labels,datasets:chartDatasets},options:opts}); } }
    _esc(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
    _trunc(s,l){ if(!s) return ''; s=String(s); return s.length>l?s.slice(0,l)+'…':s; }
}

// ==================== FUNCIONES GLOBALES (definidas fuera de las clases) ====================
let currentUser = null;
let _app, _ui;

window.closeModal = (id) => document.getElementById(id)?.classList.remove('active');
window.clearBulkSelection = () => { if(_ui) _ui.selectedRows.clear(); _ui?._renderBulkBar(); _ui?.render(); };
window.goToHistory = (deviceId) => { document.querySelector('.sidebar-item[data-tab="history"]')?.click(); if(deviceId && _app){ let d=_app.devices.get(deviceId); if(d) document.getElementById('historyClientFilter').value=d.cliente; } updateHistoryDisplay(deviceId); };
window.goToSupport = (deviceId) => { document.querySelector('.sidebar-item[data-tab="support"]')?.click(); if(deviceId && _app){ let d=_app.devices.get(deviceId); if(d){ document.getElementById('supportClientFilter').value=d.cliente; updateSupportDeviceSelect(); setTimeout(()=>{ let sel=document.getElementById('supportDeviceSelect'); if(sel){ sel.value=deviceId; displaySupportForDevice(deviceId); } },120); } } };
window.openManualModal = (deviceId) => { let d=_app?.devices.get(deviceId); if(!d) return; window._currentManualDeviceId=deviceId; let colors={connected:'var(--success)',warning:'var(--warning)',critical:'var(--danger)',disconnected:'var(--gray)'}; let labels={connected:'✅ Conectado',warning:'🟡 Alerta',critical:'🔴 Crítico',disconnected:'⚪ Desconectado'}; document.getElementById('manualDeviceInfo').innerHTML=`<p><strong>Dispositivo:</strong> ${escapeHtml(d.nombre)}</p><p><strong>Cliente:</strong> ${escapeHtml(d.cliente)}</p><p><strong>Estado:</strong> <span style="color:${colors[d.alertLevel]}">${labels[d.alertLevel]||escapeHtml(d.alertLevel)}</span></p>`; document.getElementById('manualNewStatus').innerHTML=d.alertLevel==='connected'?'<option value="connected" selected>✅ Conectado</option><option value="disconnected">⚪ Desconectado</option>':'<option value="connected">✅ Conectado</option><option value="disconnected" selected>⚪ Desconectado</option>'; document.getElementById('manualChangeNote').value=''; document.getElementById('manualModal').classList.add('active'); };
window.toggleWatch = (deviceId) => { let added=_app.toggleWatch(deviceId); Toast.show(added?'⭐ Añadido a favoritos':'✕ Quitado de favoritos',added?'success':'info'); _ui._updateWatchlist(); _ui.render(); };
function applyManualStatus() { if(!window._currentManualDeviceId) return; let newStatus=document.getElementById('manualNewStatus').value; let note=document.getElementById('manualChangeNote').value; let ok=_app.manualStatusChange(window._currentManualDeviceId,newStatus,note); if(ok) Toast.show(`🔌 Estado cambiado a ${newStatus==='connected'?'Conectado':'Desconectado'}`,'success'); closeModal('manualModal'); window._currentManualDeviceId=null; }
function openSupportModal(deviceId) { let d=_app?.devices.get(deviceId); if(!d) return; window._currentSupportDevice=deviceId; let base=_app?.baseDevices.get(deviceId); let savedName=(base&&base.nombre)||d.nombre; document.getElementById('supportModalDeviceInfo').innerHTML=`<div style='display:flex;flex-direction:column;gap:4px'><p><strong>📺 Dispositivo:</strong> ${escapeHtml(savedName)}</p><p><strong>🏢 Cliente:</strong> ${escapeHtml(d.cliente)} · ${escapeHtml(d.pais)}</p><p><strong>📡 Estado actual:</strong> <span style='color:${{connected:'var(--success)',warning:'var(--warning)',critical:'var(--danger)',disconnected:'var(--gray)'}[d.alertLevel]}'>${{connected:'✅ Conectado',warning:'🟡 Alerta',critical:'🔴 Crítico',disconnected:'⚪ Desconectado'}[d.alertLevel] || escapeHtml(d.alertLevel)}</span></p></div>`; document.getElementById('supportDate').value=new Date().toISOString().split('T')[0]; document.getElementById('supportTechnician').value=''; document.getElementById('supportDescription').value=''; document.getElementById('supportSolution').value=''; document.getElementById('supportType').value='correctivo'; document.getElementById('supportResult').value='resuelto'; document.getElementById('supportModal').classList.add('active'); }
function updateSupportDeviceSelect() {
    const client = document.getElementById('supportClientFilter')?.value || 'all';
    let devs = (_app?.getDevices() || [])
        .filter(d => client === 'all' || d.cliente === client)
        .sort((a,b) => {
            const na = (_app?.baseDevices.get(a.id)?.nombre || a.nombre).toLowerCase();
            const nb = (_app?.baseDevices.get(b.id)?.nombre || b.nombre).toLowerCase();
            return na.localeCompare(nb);
        });
    const sel = document.getElementById('supportDeviceSelect');
    if(!sel) return;
    sel.innerHTML = '<option value="">Todos los dispositivos</option>' +
        devs.map(d => {
            const base = _app?.baseDevices.get(d.id);
            const name = (base && base.nombre) || d.nombre;
            return `<option value="${escapeAttr(d.id)}">${escapeHtml(d.cliente)} - ${escapeHtml(name.slice(0,55))}</option>`;
        }).join('');
    sel.onchange = () => {
        if(sel.value) displaySupportForDevice(sel.value);
        else applyAllTicketFilters();
    };
}
function displaySupportForDevice(deviceId) {
    let d    = _app?.devices.get(deviceId);
    let base = _app?.baseDevices.get(deviceId);
    let savedName = (base&&base.nombre)||(d&&d.nombre)||'Dispositivo';
    if(!d && !base){ document.getElementById('supportContent').innerHTML='<div class="empty-state"><div class="icon">❓</div><p>Dispositivo no encontrado</p></div>'; return; }
    const ref = d || base;
    const statusColors = {connected:'var(--success)',warning:'var(--warning)',critical:'var(--danger)',disconnected:'var(--gray)'};
    const statusLabels = {connected:'✅ Conectado',warning:'🟡 Alerta',critical:'🔴 Crítico',disconnected:'⚪ Desconectado'};
    let supports = _app?.getSupports(deviceId)||[];
    const total     = supports.length;
    const resolved  = supports.filter(s=>s.result==='resuelto').length;
    const pending   = supports.filter(s=>s.result==='pendiente').length;
    const unresolved= supports.filter(s=>s.result==='no_resuelto').length;

    let html = `<div class="device-info-box" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
            <p style="font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:4px">
                <span style="color:var(--accent)">📺</span> ${escapeHtml(savedName)}
            </p>
            <p style="font-size:0.75rem;color:var(--text-secondary)">🏢 ${escapeHtml(ref.cliente)} · ${escapeHtml(ref.pais)}${d?` · <span style="color:${statusColors[d.alertLevel]}">${statusLabels[d.alertLevel]}</span>`:''}</p>
            ${d?`<p style="font-size:0.72rem;color:var(--text-muted);margin-top:3px">🕒 Último acceso: ${escapeHtml(d.ultimoAcceso)}</p>`:''}
        </div>
        ${can('canCreateTicket') ? `<button class="action-pill" onclick="openSupportModal(decodeSafeId('${safeIdForJs(deviceId)}'))">➕ Nuevo ticket</button>` : ''}
    </div>`;

    if(!supports.length){
        html += '<div class="empty-state"><div class="icon">📭</div><p>Sin registros de soporte para este dispositivo</p></div>';
    } else {
        html += `<div class="stats-row">
            <div class="stat-box"><div class="stat-val">${total}</div><div class="stat-lbl">Total</div></div>
            <div class="stat-box"><div class="stat-val" style="color:var(--success)">${resolved}</div><div class="stat-lbl">Resueltos</div></div>
            <div class="stat-box"><div class="stat-val" style="color:#60a5fa">${pending}</div><div class="stat-lbl">Pendientes</div></div>
            <div class="stat-box"><div class="stat-val" style="color:var(--danger)">${unresolved}</div><div class="stat-lbl">No resueltos</div></div>
        </div><div class="ticket-list">`;
        for(let s of supports) html += _buildTicketCard(s, deviceId);
        html += '</div>';
    }
    document.getElementById('supportContent').innerHTML = html;
}
function openEditTicketModal(deviceId, ticketNumber) { let tickets = _app.getSupports(deviceId); let ticket = tickets.find(t => t.ticketNumber === ticketNumber); if(!ticket) return; let device = _app.devices.get(deviceId) || _app.baseDevices.get(deviceId); let savedName = ticket.deviceName || (device ? device.nombre : 'Dispositivo'); document.getElementById('editTicketDeviceInfo').innerHTML = `<div style='display:flex;flex-direction:column;gap:4px'><p><strong>📺 Dispositivo:</strong> ${escapeHtml(savedName)}</p><p><strong>🎫 Ticket #${ticketNumber}</strong></p></div>`; document.getElementById('editTicketDate').value = ticket.date; document.getElementById('editTicketType').value = ticket.type; document.getElementById('editTicketTechnician').value = ticket.technician; document.getElementById('editTicketDescription').value = ticket.description; document.getElementById('editTicketSolution').value = ticket.solution || ''; document.getElementById('editTicketResult').value = ticket.result; document.getElementById('editTicketModal').classList.add('active'); window._editTicketContext = { deviceId, ticketNumber }; }
document.getElementById('editTicketForm')?.addEventListener('submit', (e) => { e.preventDefault(); if(!window._editTicketContext) return; let { deviceId, ticketNumber } = window._editTicketContext; let updatedTicket = { date: document.getElementById('editTicketDate').value, type: document.getElementById('editTicketType').value, technician: document.getElementById('editTicketTechnician').value, description: document.getElementById('editTicketDescription').value, solution: document.getElementById('editTicketSolution').value, result: document.getElementById('editTicketResult').value }; _app.updateTicket(deviceId, ticketNumber, updatedTicket); closeModal('editTicketModal'); Toast.show(`Ticket #${ticketNumber} actualizado`, 'success'); displaySupportForDevice(deviceId); _ui._updateCharts(); });
function updateHistoryDisplay(focusDeviceId){ let client=document.getElementById('historyClientFilter')?.value||'all'; let type=document.getElementById('historyChangeTypeFilter')?.value||'all'; let changes=_app?.historyChanges||[]; if(client!=='all') changes=changes.filter(c=>c.cliente===client); if(type!=='all') changes=changes.filter(c=>{ switch(type){ case 'reconnect': return c.oldStatus!=='connected'&&c.newStatus==='connected'&&c.changeType!=='manual'; case 'disconnect': return c.oldStatus==='connected'&&c.newStatus!=='connected'&&c.newStatus!=='eliminado'&&c.changeType!=='manual'; case 'warning': return c.newStatus==='warning'&&c.changeType!=='manual'; case 'new': return c.changeType==='new'; case 'removed': return c.changeType==='removed'; case 'manual': return c.changeType==='manual'; } return true; }); if(focusDeviceId) changes=changes.filter(c=>c.deviceId===focusDeviceId); let container=document.getElementById('historyContent'); if(!changes.length){ container.innerHTML='<div class="empty-state"><div class="icon">📜</div><p>No hay cambios para mostrar</p></div>'; return; } let cn=changes.filter(c=>c.changeType==='new').length, cr=changes.filter(c=>c.changeType==='removed').length; let rec=changes.filter(c=>c.oldStatus!=='connected'&&c.newStatus==='connected'&&c.changeType!=='manual').length; let dis=changes.filter(c=>c.oldStatus==='connected'&&c.newStatus!=='connected'&&c.newStatus!=='eliminado'&&c.changeType!=='manual').length; let man=changes.filter(c=>c.changeType==='manual').length; let html=`<div class="stats-row"><div class="stat-box"><div class="stat-val">${changes.length}</div><div class="stat-lbl">Total</div></div><div class="stat-box"><div class="stat-val" style="color:var(--accent)">${cn}</div><div class="stat-lbl">🆕 Nuevos</div></div><div class="stat-box"><div class="stat-val" style="color:var(--gray)">${cr}</div><div class="stat-lbl">❌ Elim.</div></div><div class="stat-box"><div class="stat-val" style="color:var(--success)">${rec}</div><div class="stat-lbl">🟢 Reconex.</div></div><div class="stat-box"><div class="stat-val" style="color:var(--danger)">${dis}</div><div class="stat-lbl">🔴 Descon.</div></div><div class="stat-box"><div class="stat-val" style="color:#60a5fa">${man}</div><div class="stat-lbl">🔵 Manuales</div></div></div><div class="ticket-list">`; for(let c of changes){ let icon='',label='',color=''; if(c.changeType==='new'){icon='🆕';label='Nuevo';color='var(--accent)';} else if(c.changeType==='removed'){icon='❌';label='Eliminado';color='var(--gray)';} else if(c.changeType==='manual'){icon='🔵';label='Manual';color='#60a5fa';} else if(c.oldStatus!=='connected'&&c.newStatus==='connected'){icon='🟢';label='Reconectado';color='var(--success)';} else if(c.oldStatus==='connected'&&c.newStatus!=='connected'){icon='🔴';label='Desconectado';color='var(--danger)';} else if(c.newStatus==='warning'){icon='🟡';label='Alerta';color='var(--warning)';} else{icon='🔄';label='Cambio';color='var(--warning)';} const deviceName=String(c.deviceName||''); html+=`<div class="ticket-item" style="border-left-color:${color}"><div class="ticket-meta"><span>🕒 ${escapeHtml(new Date(c.timestamp).toLocaleString())}</span><span style="background:${color}20;color:${color};padding:1px 8px;border-radius:10px">${icon} ${label}</span></div><div class="ticket-desc">📺 ${escapeHtml(deviceName.slice(0,65))}${deviceName.length>65?'…':''}</div><div class="ticket-foot">🏢 ${escapeHtml(c.cliente)} · ${escapeHtml(c.pais)} · <strong>${escapeHtml(c.oldStatus)} → ${escapeHtml(c.newStatus)}</strong>${c.daysOffline?` · ⚠️ ${Number(c.daysOffline).toFixed(1)}d`:''}${c.note?`<br>📝 ${escapeHtml(c.note)}`:''}</div></div>`; } html+='</div>'; container.innerHTML=html; }
function showTicketDetail(ticketNumber){
    for(let [deviceId,tickets] of (_app?.supports||new Map())){
        let t = tickets.find(t=>t.ticketNumber===ticketNumber);
        if(!t) continue;
        let d    = _app?.devices.get(deviceId);
        let base = _app?.baseDevices.get(deviceId);
        const savedName = _resolveDeviceName({...t, deviceId});
        const ref = d || base;
        const typeMap   = {preventivo:'🛡️ Preventivo',correctivo:'🔧 Correctivo',configuracion:'⚙️ Configuración',conectividad:'🌐 Conectividad',hardware:'💻 Hardware',software:'📱 Software',otro:'📝 Otro'};
        const resultMap = {resuelto:'✅ Resuelto',parcial:'⚠️ Parcial',pendiente:'⏳ Pendiente',no_resuelto:'❌ No resuelto'};
        const resultColors = {resuelto:'var(--success)',parcial:'var(--warning)',pendiente:'#60a5fa',no_resuelto:'var(--danger)'};
        const solutionHtml = t.solution
            ? `<div class="form-group"><label>🔧 Solución aplicada</label>
               <div style="background:var(--bg-tertiary);padding:12px;border-radius:var(--radius-sm);white-space:pre-wrap;border-left:3px solid var(--success);line-height:1.6">${escapeHtml(t.solution)}</div></div>`
            : '';
        document.getElementById('ticketDetailBody').innerHTML = `
            <div style="background:var(--bg-tertiary);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:16px;border-left:4px solid var(--accent)">
                <div style="font-size:1rem;font-weight:700;color:var(--text-primary);margin-bottom:8px">
                    <span style="color:var(--accent)">📺</span> ${escapeHtml(savedName)}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:0.72rem;color:var(--text-secondary)">
                    ${ref?`<span style="background:var(--bg-card);padding:2px 9px;border-radius:20px;border:1px solid var(--border-color)">🏢 ${escapeHtml(ref.cliente)}</span>`:''}
                    ${ref?`<span style="background:var(--bg-card);padding:2px 9px;border-radius:20px;border:1px solid var(--border-color)">${escapeHtml(ref.pais)}</span>`:''}
                    <span style="background:var(--accent-dim);color:var(--accent);padding:2px 9px;border-radius:20px;font-family:var(--font-mono)">🎫 #${t.ticketNumber}</span>
                    <span style="background:var(--bg-card);padding:2px 9px;border-radius:20px;border:1px solid var(--border-color)">📅 ${escapeHtml(t.date)}</span>
                    <span style="background:var(--bg-card);padding:2px 9px;border-radius:20px;border:1px solid var(--border-color)">${typeMap[t.type]||escapeHtml(t.type)}</span>
                    <span style="background:${resultColors[t.result]||'var(--gray)'}20;color:${resultColors[t.result]||'var(--gray)'};padding:2px 9px;border-radius:20px;font-weight:700">${resultMap[t.result]||escapeHtml(t.result)}</span>
                </div>
                <div style="margin-top:8px;font-size:0.72rem;color:var(--text-muted)">👨‍🔧 Técnico: <strong style="color:var(--text-secondary)">${escapeHtml(t.technician||'—')}</strong></div>
            </div>
            <div class="form-group">
                <label>📝 Descripción del problema</label>
                <div style="background:var(--bg-tertiary);padding:12px;border-radius:var(--radius-sm);white-space:pre-wrap;line-height:1.6;font-size:0.8rem">${escapeHtml(t.description||'—')}</div>
            </div>
            ${solutionHtml}
            <button class="action-pill" onclick="closeModal('ticketDetailModal');openEditTicketModal(decodeSafeId('${safeIdForJs(deviceId)}'), ${t.ticketNumber})">✏️ Editar ticket</button>`;
        document.getElementById('ticketDetailModal').classList.add('active');
        return;
    }
    Toast.show(`Ticket #${ticketNumber} no encontrado`,'warning');
}
function _populateTechFilter(tickets) {
    const sel = document.getElementById('ticketTechFilter');
    if(!sel) return;
    const cur = sel.value;
    const techs = [...new Set(tickets.map(t => t.technician).filter(Boolean))].sort();
    sel.innerHTML = '<option value="all">Todos los técnicos</option>' +
        techs.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
    if(cur) sel.value = cur;
}

function applyAllTicketFilters(){
    const client   = document.getElementById('supportClientFilter')?.value || 'all';
    const deviceId = document.getElementById('supportDeviceSelect')?.value || '';
    const status   = document.getElementById('ticketStatusFilter')?.value  || 'all';
    const type     = document.getElementById('ticketTypeFilter')?.value    || 'all';
    const tech     = document.getElementById('ticketTechFilter')?.value    || 'all';
    const dateFrom = document.getElementById('ticketDateFrom')?.value      || '';
    const dateTo   = document.getElementById('ticketDateTo')?.value        || '';
    const freeText = (document.getElementById('ticketFreeSearch')?.value   || '').trim().toLowerCase();

    let tickets = _app?.getAllSupports() || [];

    // Rellenar técnicos con el universo actual antes de filtrar
    _populateTechFilter(tickets);

    // Filtro por dispositivo específico
    if(deviceId) {
        tickets = (_app?.getSupports(deviceId) || []).map(t => ({...t, deviceId}));
    } else if(client !== 'all') {
        const clientDevIds = new Set(
            (_app?.getDevices() || []).filter(d => d.cliente === client).map(d => d.id)
        );
        const filtered = [];
        for(let [id, ts] of (_app?.supports || new Map())) {
            if(clientDevIds.has(id)) ts.forEach(t => filtered.push({...t, deviceId: id}));
        }
        tickets = filtered.sort((a,b) => b.ticketNumber - a.ticketNumber);
    }

    // Filtros simples
    if(status   !== 'all') tickets = tickets.filter(t => t.result === status);
    if(type     !== 'all') tickets = tickets.filter(t => t.type   === type);
    if(tech     !== 'all') tickets = tickets.filter(t => t.technician === tech);
    if(dateFrom)           tickets = tickets.filter(t => t.date >= dateFrom);
    if(dateTo)             tickets = tickets.filter(t => t.date <= dateTo);

    // Búsqueda libre — número, nombre, técnico, descripción, solución, cliente
    if(freeText) {
        const num = parseInt(freeText);
        tickets = tickets.filter(t => {
            if(!isNaN(num) && t.ticketNumber === num) return true;
            const devName = (_resolveDeviceName(t) || '').toLowerCase();
            return devName.includes(freeText)
                || (t.technician   || '').toLowerCase().includes(freeText)
                || (t.description  || '').toLowerCase().includes(freeText)
                || (t.solution     || '').toLowerCase().includes(freeText)
                || (t.deviceName   || '').toLowerCase().includes(freeText);
        });
    }

    // Contador de resultados
    const info = document.getElementById('supportResultsInfo');
    if(info) {
        info.style.display = tickets.length > 0 || freeText || status !== 'all' ? '' : 'none';
        info.textContent = `${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}`;
        info.style.color = tickets.length === 0 ? 'var(--danger)' : '';
    }

    renderTicketList(tickets, freeText);
}

function clearTicketFilters(){
    ['supportClientFilter','ticketStatusFilter','ticketTypeFilter','ticketTechFilter'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = el.options[0]?.value || 'all';
    });
    ['ticketFreeSearch','ticketDateFrom','ticketDateTo'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
    const devSel = document.getElementById('supportDeviceSelect');
    if(devSel) { devSel.value = ''; }
    document.getElementById('supportResultsInfo').style.display = 'none';
    document.getElementById('supportContent').innerHTML =
        '<div class="empty-state"><div class="icon">🎫</div><p>Usa los filtros para buscar tickets</p></div>';
    updateSupportDeviceSelect();
}

function _getOpenTickets(deviceId) {
    const tickets = _app?.supports.get(deviceId) || [];
    return tickets.filter(t => t.result === 'pendiente' || t.result === 'parcial' || t.result === 'no_resuelto');
}
function _openTicketBadge(deviceId) {
    const open = _getOpenTickets(deviceId);
    if(!open.length) return '';
    const urgent = open.filter(t => {
        if(!t.createdAt) return false;
        const hrs = (Date.now() - new Date(t.createdAt).getTime()) / 3600000;
        return hrs >= 72;
    });
    const color = urgent.length ? 'var(--danger)' : '#60a5fa';
    const icon  = urgent.length ? '🔴' : '🎫';
    return `<span title="${open.length} ticket(s) abierto(s)${urgent.length ? ' — ¡URGENTE!' : ''}" style="background:${color}22;color:${color};border:1px solid ${color}55;border-radius:var(--radius-pill);padding:1px 7px;font-size:0.68rem;font-weight:700;white-space:nowrap">${icon} ${open.length}</span>`;
}

function _resolveDeviceName(ticket) {
    // 1. Nombre guardado en el ticket
    if(ticket.deviceName && ticket.deviceName !== 'Dispositivo desconocido') return ticket.deviceName;
    // 2. Desde baseDevices usando deviceId del ticket
    if(ticket.deviceId) {
        let base = _app?.baseDevices.get(ticket.deviceId);
        if(base && base.nombre) return base.nombre;
        let live = _app?.devices.get(ticket.deviceId);
        if(live && live.nombre) return live.nombre;
    }
    return ticket.deviceName || 'Dispositivo';
}

function _buildTicketCard(ticket, deviceId, highlight="") {
    const typeMap = {preventivo:'🛡️ Preventivo',correctivo:'🔧 Correctivo',configuracion:'⚙️ Configuración',conectividad:'🌐 Conectividad',hardware:'💻 Hardware',software:'📱 Software',otro:'📝 Otro'};
    const resultMap = {resuelto:'✅ Resuelto',parcial:'⚠️ Parcial',pendiente:'⏳ Pendiente',no_resuelto:'❌ No resuelto'};
    const resultBadgeClass = {resuelto:'result-badge-resuelto',parcial:'result-badge-parcial',pendiente:'result-badge-pendiente',no_resuelto:'result-badge-no_resuelto'};

    const devName = _resolveDeviceName(ticket);
    const devId = deviceId || ticket.deviceId || '';
    function _hl(text) {
        if(!highlight || !text) return text || '';
        const re = new RegExp('(' + highlight.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
        return String(text).replace(re, '<mark class="ticket-highlight">$1</mark>');
    }
    const result = ticket.result || 'pendiente';
    const _rawDesc = (ticket.description || '').slice(0, 130) + ((ticket.description||'').length > 130 ? '…' : '');
    const desc = _hl(_rawDesc);

    // Cálculo de tiempo de resolución / tiempo transcurrido
    function _ticketAgeHtml(ticket) {
        const created = ticket.createdAt ? new Date(ticket.createdAt) : null;
        const result  = ticket.result;
        if(!created) return '';
        const now = Date.now();
        const msElapsed = now - created.getTime();
        const hrsElapsed = msElapsed / 3600000;
        const daysE = Math.floor(hrsElapsed / 24);
        const hrsE  = Math.floor(hrsElapsed % 24);

        if(result === 'resuelto' || result === 'parcial') {
            // Tiempo hasta resolución: usamos date del ticket (fecha de cierre manual)
            const closed = ticket.date ? new Date(ticket.date + 'T12:00:00') : null;
            if(closed && closed > created) {
                const msRes = closed.getTime() - created.getTime();
                const hrsRes = msRes / 3600000;
                const dR = Math.floor(hrsRes / 24), hR = Math.floor(hrsRes % 24);
                const timeStr = dR > 0 ? `${dR}d ${hR}h` : `${Math.round(hrsRes)}h`;
                return `<div style="font-size:0.69rem;color:var(--success);margin-top:3px">⏱️ Resuelto en ${timeStr}</div>`;
            }
            return '';
        }

        // Ticket abierto: mostrar tiempo transcurrido y alerta si > 72h
        const timeStr = daysE > 0 ? `${daysE}d ${hrsE}h` : `${Math.round(hrsElapsed)}h`;
        if(hrsElapsed >= 72) {
            return `<div style="font-size:0.69rem;color:var(--danger);font-weight:700;margin-top:3px;background:var(--danger-dim);padding:2px 7px;border-radius:6px;display:inline-block">⚠️ ABIERTO ${timeStr} — URGENTE</div>`;
        }
        return `<div style="font-size:0.69rem;color:#60a5fa;margin-top:3px">🕒 Abierto hace ${timeStr}</div>`;
    }
    const ageHtml = _ticketAgeHtml(ticket);

    const solutionHtml = ticket.solution
        ? `<div class="ticket-solution-preview"><span>🔧</span><span>${ticket.solution.slice(0,100)}${ticket.solution.length>100?'…':''}</span></div>`
        : '';

    // Buscar info del dispositivo para cliente
    const devObj = _app?.baseDevices.get(devId) || _app?.devices.get(devId);
    const clienteInfo = devObj ? `<span class="tag">🏢 ${devObj.cliente}</span>` : '';
    const paisInfo = devObj ? `<span class="tag">${devObj.pais}</span>` : '';

    return `<div class="ticket-item result-${result}" onclick="showTicketDetail(${ticket.ticketNumber})">
        <div class="ticket-stripe"></div>
        <div class="ticket-device-header">
            <div class="ticket-device-name" title="${devName}"><span class="device-icon">📺</span>${_hl(devName)}</div>
            <span class="ticket-number-badge">#${ticket.ticketNumber}</span>
        </div>
        <div class="ticket-body">
            <div class="ticket-meta">
                <span>📅 ${ticket.date}</span>
                <span class="tag">${typeMap[ticket.type]||ticket.type}</span>
                ${clienteInfo}${paisInfo}
            </div>
            ${desc ? `<div class="ticket-description">${desc}</div>` : ''}
            ${ageHtml}
            ${solutionHtml}
        </div>
        <div class="ticket-footer">
            <span class="ticket-technician">👨‍🔧 ${ticket.technician||'—'}</span>
            <span class="ticket-result-badge ${resultBadgeClass[result]||''}">${resultMap[result]||result}</span>
            <div class="ticket-actions">
                ${can('canEditTicket') ? `<button class="micro-btn edit-ticket" onclick="event.stopPropagation();openEditTicketModal('${devId}', ${ticket.ticketNumber})">✏️ Editar</button>` : ''}
            </div>
        </div>
    </div>`;
}
function renderTicketList(tickets, highlight=""){
    if(!tickets.length){ document.getElementById('supportContent').innerHTML='<div class="empty-state"><div class="icon">🎫</div><p>No hay tickets con esos filtros</p></div>'; return; }
    const resolved = tickets.filter(t=>t.result==='resuelto').length;
    const pending  = tickets.filter(t=>t.result==='pendiente').length;
    const noRes    = tickets.filter(t=>t.result==='no_resuelto').length;
    let html = `<div class="stats-row">
        <div class="stat-box"><div class="stat-val">${tickets.length}</div><div class="stat-lbl">Total</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--success)">${resolved}</div><div class="stat-lbl">Resueltos</div></div>
        <div class="stat-box"><div class="stat-val" style="color:#60a5fa">${pending}</div><div class="stat-lbl">Pendientes</div></div>
        <div class="stat-box"><div class="stat-val" style="color:var(--danger)">${noRes}</div><div class="stat-lbl">No resueltos</div></div>
    </div><div class="ticket-list">`;
    for(let t of tickets) html += _buildTicketCard(t, t.deviceId, highlight);
    html += '</div>';
    document.getElementById('supportContent').innerHTML = html;
}
function exportReport(){ let dataType=document.getElementById('exportDataType').value; let format=document.getElementById('exportFormat').value; let client=document.getElementById('exportClientFilter').value; let dateFrom=document.getElementById('exportDateFrom').value; let dateTo=document.getElementById('exportDateTo').value; let exportData={exportDate:new Date().toISOString(),filters:{client,dateFrom,dateTo,dataType}}; if(dataType==='devices'||dataType==='all'){ let devs=_app?.getDevices()||[]; if(client!=='all') devs=devs.filter(d=>d.cliente===client); exportData.devices=devs.map(d=>({ID:d.id,Cliente:d.cliente,Dispositivo:d.nombre,País:d.pais,Estado:d.alertLevel,UltimoAcceso:d.ultimoAcceso,DiasOffline:d.diasDesconexion!=null?d.diasDesconexion.toFixed(1):'N/A',IP:d.ip,Ubicacion:d.ubicacion,SO:d.so})); } if(dataType==='tickets'||dataType==='all'){ let tickets=_app?.getAllSupports()||[]; if(client!=='all'){ let devIds=new Set((_app?.getDevices()||[]).filter(d=>d.cliente===client).map(d=>d.id)); let ok=new Set(); for(let id of devIds) for(let t of (_app.supports.get(id)||[])) ok.add(t.ticketNumber); tickets=tickets.filter(t=>ok.has(t.ticketNumber)); } if(dateFrom||dateTo) tickets=tickets.filter(t=>{if(dateFrom&&t.date<dateFrom)return false; if(dateTo&&t.date>dateTo)return false; return true;}); exportData.tickets=tickets.map(t=>({Ticket:t.ticketNumber,Fecha:t.date,Tipo:t.type,Tecnico:t.technician,Descripcion:t.description,Solucion:t.solution||'',Resultado:t.result,Dispositivo:t.deviceName||''})); } if(dataType==='history'||dataType==='all'){ let history=_app?.historyChanges||[]; if(client!=='all') history=history.filter(h=>h.cliente===client); if(dateFrom||dateTo) history=history.filter(h=>{let d=h.timestamp.split('T')[0]; if(dateFrom&&d<dateFrom)return false; if(dateTo&&d>dateTo)return false; return true;}); exportData.history=history; } if(format==='csv'){ let rows=[['Reporte NEOMEDIA DIGITAL',new Date().toLocaleString()]]; let toRow=(obj,headers)=>headers.map(h=>`"${String(obj[h]||'').replace(/"/g,'""')}"`); if(exportData.devices?.length){ let h=Object.keys(exportData.devices[0]); rows.push(['=== DISPOSITIVOS ==='],h,...exportData.devices.map(d=>toRow(d,h))); } if(exportData.tickets?.length){ let h=Object.keys(exportData.tickets[0]); rows.push(['=== TICKETS ==='],h,...exportData.tickets.map(t=>toRow(t,h))); } if(exportData.history?.length){ let h=['deviceName','cliente','oldStatus','newStatus','timestamp','note']; rows.push(['=== HISTORIAL ==='],h,...exportData.history.map(e=>toRow(e,h))); } _download(rows.map(r=>r.join(',')).join('\n'),`reporte_neomedia_${nmTimestamp()}.csv`,'text/csv;charset=utf-8','\uFEFF'); } else if(format==='html'){ let tbl=(rows,headers)=>`<table border="1" cellpadding="6" style="border-collapse:collapse;font-size:12px"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</thead><tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${r[h]||''}</td>`).join('')}</tr>`).join('')}</tbody></table>`; let html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte NEOMEDIA</title><style>body{font-family:sans-serif;padding:20px;background:#f5f5f5}</style></head><body><h1>NEOMEDIA DIGITAL — Reporte</h1><p>Generado: ${new Date().toLocaleString()}</p>`; if(exportData.devices?.length) html+=`<h2>Dispositivos (${exportData.devices.length})</h2>${tbl(exportData.devices,Object.keys(exportData.devices[0]))}`; if(exportData.tickets?.length) html+=`<h2>Tickets (${exportData.tickets.length})</h2>${tbl(exportData.tickets,Object.keys(exportData.tickets[0]))}`; if(exportData.history?.length){ let h=['deviceName','cliente','oldStatus','newStatus','timestamp','note']; html+=`<h2>Historial (${exportData.history.length})</h2>${tbl(exportData.history,h)}`; } html+='</body></html>'; _download(html,`reporte_neomedia_${nmTimestamp()}.html`,'text/html;charset=utf-8'); } else { _download(JSON.stringify(exportData,null,2),`reporte_neomedia_${nmTimestamp()}.json`,'application/json'); } closeModal('exportModal'); Toast.show('✅ Reporte exportado','success'); }
function _download(content,filename,mime,bom=''){ let blob=new Blob([bom+content],{type:mime}); let a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }
function startAutoRefresh(seconds){ let el=document.getElementById('refreshCountdown'); if(window._autoRefreshTimer) clearInterval(window._autoRefreshTimer); if(window._autoRefreshCountdown) clearInterval(window._autoRefreshCountdown); if(!seconds){ if(el) el.textContent='—'; return; } let remaining=seconds; if(el) el.textContent=remaining+'s'; window._autoRefreshCountdown=setInterval(()=>{ remaining--; if(el) el.textContent=remaining+'s'; if(remaining<=0) remaining=seconds; },1000); window._autoRefreshTimer=setInterval(()=>{ _ui?.render(); Toast.show('🔄 Vista actualizada','info'); },seconds*1000); }
function startAlertMonitoring(){
    if(window.alertInterval) clearInterval(window.alertInterval);
    window.alertInterval = setInterval(checkAndSendAlerts, 30000);
    // Verificar tickets vencidos > 72h cada 5 min
    if(window._overdueInterval) clearInterval(window._overdueInterval);
    window._overdueInterval = setInterval(checkOverdueTickets, 300000);
    setTimeout(checkOverdueTickets, 9000); // Primera revisión al iniciar
}
function checkOverdueTickets() {
    if(!_app) return;
    const allTickets = _app.getAllSupports() || [];
    const overdue = allTickets.filter(t => {
        if(t.result === 'resuelto') return false;
        if(!t.createdAt) return false;
        const hrs = (Date.now() - new Date(t.createdAt).getTime()) / 3600000;
        return hrs >= 72;
    });
    if(!overdue.length) return;
    const deviceCount = new Set(overdue.map(t => t.deviceId || t.deviceName)).size;
    Toast.show(`⚠️ ${overdue.length} ticket${overdue.length>1?'s':''} con más de 72h abiertos en ${deviceCount} dispositivo${deviceCount>1?'s':''}`, 'error', 7000);
}
function alertParams(overrides={}) {
    return {
        to_email: localStorage.getItem('alert_emails') || '',
        device_name: 'PRUEBA',
        client: 'Sistema',
        status: '🔔 Prueba de alerta',
        days_offline: '0',
        last_access: new Date().toLocaleString(),
        time: new Date().toLocaleString(),
        ...overrides
    };
}
async function sendEmailAlert(params) {
    const init = initEmailService();
    if(!init.ok) throw new Error(init.reason);
    return EmailService.send(init.cfg.serviceId, init.cfg.templateId, params);
}
function updateEmailAlertStatus() {
    const status = document.getElementById('emailAlertStatus');
    if(!status) return;
    const cfg = getEmailConfig();
    const missing = [];
    if(!window.emailjs) missing.push('librería EmailJS');
    if(!cfg.publicKey) missing.push('Public Key');
    if(!cfg.serviceId) missing.push('Service ID');
    if(!cfg.templateId) missing.push('Template ID');
    status.textContent = missing.length
        ? `Estado: faltan ${missing.join(', ')}. Las alertas internas funcionan, pero no se enviarán correos.`
        : 'Estado: configuración completa. Ya puedes enviar correo de prueba.';
    status.style.color = missing.length ? 'var(--warning)' : 'var(--success)';
}
async function checkAndSendAlerts(){
    let enabled=localStorage.getItem('alerts_enabled')!=='false';
    if(!enabled) return;
    let recipients=localStorage.getItem('alert_emails')||'';
    if(!recipients) return;
    let warningDays=parseFloat(localStorage.getItem('warning_threshold')||'2');
    let criticalDays=parseFloat(localStorage.getItem('critical_threshold')||'7');
    let devices=_app?.getDevices()||[];
    let sentKey='alerts_sent_'+currentUser?.email;
    let sent={};
    try { sent=JSON.parse(localStorage.getItem(sentKey)||'{}'); } catch(e) { sent={}; }
    let now=Date.now();
    let updated=false;
    for(let d of devices){
        if(!d.diasDesconexion) continue;
        let level=null;
        if(d.alertLevel==='critical' && d.diasDesconexion>=criticalDays) level='critical';
        else if(d.alertLevel==='warning' && d.diasDesconexion>=warningDays && d.diasDesconexion<criticalDays) level='warning';
        if(level){
            let last=sent[d.id]||0;
            if(now-last>6*3600*1000){
                try{
                    await sendEmailAlert(alertParams({
                        device_name:d.nombre,
                        client:d.cliente,
                        status:level==='critical'?'🔴 CRÍTICO':'🟡 ALERTA',
                        days_offline:d.diasDesconexion.toFixed(1),
                        last_access:d.ultimoAcceso
                    }));
                    sent[d.id]=now;
                    updated=true;
                } catch(e){
                    console.warn('No se pudo enviar alerta por correo:', e.message || e);
                }
            }
        } else if(sent[d.id]){
            delete sent[d.id];
            updated=true;
        }
    }
    if(updated) localStorage.setItem(sentKey,JSON.stringify(sent));
}
document.getElementById('saveAlertConfig')?.addEventListener('click',()=>{
    let emails=document.getElementById('alertEmails').value.trim();
    let warning=document.getElementById('warningThreshold').value;
    let critical=document.getElementById('criticalThreshold').value;
    let enabled=document.getElementById('alertsEnabled').value==='true';
    localStorage.setItem('alert_emails',emails);
    localStorage.setItem('warning_threshold',warning);
    localStorage.setItem('critical_threshold',critical);
    localStorage.setItem('alerts_enabled',enabled);
    localStorage.setItem('emailjs_public_key',document.getElementById('emailjsPublicKey').value.trim());
    localStorage.setItem('emailjs_service_id',document.getElementById('emailjsServiceId').value.trim());
    localStorage.setItem('emailjs_template_id',document.getElementById('emailjsTemplateId').value.trim());
    updateEmailAlertStatus();
    Toast.show('Configuración guardada','success');
});
document.getElementById('testAlertBtn')?.addEventListener('click',async()=>{
    let emails=localStorage.getItem('alert_emails');
    if(!emails){ Toast.show('Primero guarda una lista de destinatarios','warning'); return; }
    try{
        await sendEmailAlert(alertParams());
        Toast.show('Correo de prueba enviado','success');
    } catch(e){
        Toast.show('No se pudo enviar: '+(e.text||e.message||e),'error',7000);
        updateEmailAlertStatus();
    }
});
document.getElementById('downloadAlertDraftBtn')?.addEventListener('click',()=>{
    const params = alertParams();
    const body = `Para: ${params.to_email}\nAsunto: ${params.status} - ${params.device_name}\n\nCliente: ${params.client}\nDispositivo: ${params.device_name}\nEstado: ${params.status}\nDías offline: ${params.days_offline}\nÚltimo acceso: ${params.last_access}\nHora de alerta: ${params.time}`;
    _download(body, `borrador_alerta_${nmTimestamp()}.txt`, 'text/plain;charset=utf-8');
    Toast.show('Borrador descargado','success');
});
function loadAlertConfig(){
    let emails=localStorage.getItem('alert_emails')||'';
    let warning=localStorage.getItem('warning_threshold')||'2';
    let critical=localStorage.getItem('critical_threshold')||'7';
    let enabled=localStorage.getItem('alerts_enabled')!=='false';
    let cfg=getEmailConfig();
    document.getElementById('alertEmails').value=emails;
    document.getElementById('warningThreshold').value=warning;
    document.getElementById('criticalThreshold').value=critical;
    document.getElementById('alertsEnabled').value=enabled?'true':'false';
    document.getElementById('emailjsPublicKey').value=cfg.publicKey;
    document.getElementById('emailjsServiceId').value=cfg.serviceId;
    document.getElementById('emailjsTemplateId').value=cfg.templateId;
    updateEmailAlertStatus();
}
document.getElementById('sidebarToggle')?.addEventListener('click', () => { document.getElementById('sidebar').classList.toggle('collapsed'); });

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    if(_app) await _app._doSave();
    currentUser = null;
    if (window._fb) { try { await window._fb.signOut(window._fb.auth); } catch(e) {} }
    setTimeout(()=>location.reload(), 150);
});
document.getElementById('changePwdBtn')?.addEventListener('click', () => openChangePasswordModal(false));
document.getElementById('saveSupportBtn')?.addEventListener('click', () => {
    if(!window._currentSupportDevice) return;
    let device = _app?.devices.get(window._currentSupportDevice);
    let ticket = {
        date: document.getElementById('supportDate').value,
        type: document.getElementById('supportType').value,
        technician: document.getElementById('supportTechnician').value,
        description: document.getElementById('supportDescription').value,
        solution: document.getElementById('supportSolution').value,
        result: document.getElementById('supportResult').value,
        deviceName: device ? device.nombre : 'Desconocido'
    };
    if(!ticket.technician || !ticket.description) { Toast.show('Completa técnico y descripción', 'warning'); return; }
    let num = _app.addSupport(window._currentSupportDevice, ticket);
    Toast.show('✅ Ticket #' + num + ' registrado', 'success');
    closeModal('supportModal');
    displaySupportForDevice(window._currentSupportDevice);
    _ui._updateCharts();
});
document.getElementById('submitPwdChange')?.addEventListener('click', async () => {
    const pwd1 = document.getElementById('newPwd1').value;
    const pwd2 = document.getElementById('newPwd2').value;
    if (!validatePassword(pwd1)) { document.getElementById('pwdError').innerText = 'La contraseña debe tener 8+ caracteres, mayúscula, minúscula, número y un símbolo (@$!%*?&)'; return; }
    if (pwd1 !== pwd2) { document.getElementById('pwdError').innerText = 'Las contraseñas no coinciden'; return; }
    await updatePassword(currentUser.email, pwd1, false);
    currentUser.isProvisional = false;
    Toast.show('Contraseña actualizada correctamente', 'success');
    closeModal('changePasswordModal');
});
document.getElementById('submitResetPwd')?.addEventListener('click', async () => {
    const newPwd = document.getElementById('resetNewPwd').value;
    if (!validatePassword(newPwd)) { document.getElementById('resetPwdError').innerText = 'La contraseña no cumple los requisitos'; return; }
    // En Firebase, el admin no puede cambiar contraseñas de otros usuarios desde el cliente.
    // Se marca como provisional en Firestore; el usuario deberá usar el enlace de restablecimiento.
    if (window._fb) {
        const { db, doc, updateDoc } = window._fb;
        await updateDoc(doc(db, 'users', resetTargetEmail), { isProvisional: true, provisionalNote: 'Reset solicitado por admin' });
        Toast.show(`📧 Usa la consola Firebase o el correo de restablecimiento para ${resetTargetEmail}`, 'info', 6000);
    } else {
        await updatePassword(resetTargetEmail, newPwd, true);
        Toast.show('Contraseña provisional actualizada para ' + resetTargetEmail, 'success');
    }
    closeModal('resetPasswordModal');
    loadUserListUI();
});
document.getElementById('addUserBtn')?.addEventListener('click', async () => {
    const email    = document.getElementById('newUserEmail').value.trim().toLowerCase();
    const password = document.getElementById('newUserPassword').value;
    const role     = document.getElementById('newUserRole')?.value || 'tecnico';
    if (!email || !password) { Toast.show('Completa email y contraseña', 'warning'); return; }
    if (!validatePassword(password)) { Toast.show('La contraseña debe tener 8+ caracteres, mayúscula, minúscula, número y carácter especial (@$!%*?&)', 'warning'); return; }
    const btn = document.getElementById('addUserBtn');
    if(btn) { btn.disabled = true; btn.textContent = 'Creando...'; }
    const ok = await addUser(email, password, currentUser?.email, true, role);
    if(btn) { btn.disabled = false; btn.textContent = 'Añadir'; }
    if (ok) {
        Toast.show(`✅ Usuario añadido como ${ROLES[role]?.label||role}`, 'success');
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPassword').value = '';
        // Si Firebase creó una nueva sesión con el usuario nuevo, volver a loguearse como admin
        if (window._needReauth) {
            window._needReauth = false;
            Toast.show('⚠️ Re-autenticando como administrador...', 'warning', 3000);
            setTimeout(() => { if(_app) _app.saveNow(); setTimeout(()=>location.reload(), 1000); }, 2000);
        } else {
            loadUserListUI();
        }
    } else {
        Toast.show('Error: el usuario ya existe o hubo un problema', 'error');
    }
});
function initApp() { _app = new App(); _ui = new UIRenderer(_app); loadAlertConfig(); startAlertMonitoring(); }

async function startupSequence() {
    const overlay  = document.getElementById('startupOverlay');
    const bar      = document.getElementById('startupProgressBar');
    const status   = document.getElementById('startupStatus');

    const setProgress = (pct, msg) => {
        bar.style.width = pct + '%';
        status.textContent = msg;
    };

    document.getElementById('appContent').style.display = 'block';

    overlay.style.display = 'flex';
    setProgress(10, 'Conectando con Firebase...');
    // Esperar a que el módulo Firebase esté listo
    let fbWaits = 0;
    while (!window._fb && fbWaits < 40) { await sleep(100); fbWaits++; }
    await sleep(80);

    setProgress(25, 'Cargando datos guardados...');
    initApp();   // crea _app, _ui, carga localStorage + inicia sync Firestore
    await sleep(150);

    setProgress(45, 'Reconstruyendo dispositivos...');
    // Forzar recalculo de días offline para todos los devices cargados
    if (_app.devices.size > 0) {
        for (let [id, d] of _app.devices) {
            let recalc = _app._calcDays(d.ultimoAcceso);
            if (recalc !== null) {
                let isConn = d.alertLevel === 'connected';
                d.diasDesconexion = isConn ? 0 : recalc;
                d.alertLevel = isConn ? 'connected'
                    : recalc >= 7 ? 'critical'
                    : recalc >= 2 ? 'warning'
                    : 'disconnected';
                _app.devices.set(id, d);
            }
        }
    }
    await sleep(120);

    setProgress(65, 'Actualizando métricas...');
    _ui.render();
    _ui._updateDropdowns();
    _ui._updateWatchlist();
    await sleep(150);

    setProgress(82, 'Cargando gráficos...');
    _ui._updateCharts();
    await sleep(150);

    setProgress(95, 'Listo...');
    await sleep(180);

    setProgress(100, '');
    await sleep(250);

    // Fade out del splash
    overlay.classList.add('fade-out');
    await sleep(420);
    overlay.style.display = 'none';
    overlay.classList.remove('fade-out');

    const total = _app.devices.size;
    const critical = _app.getDevices().filter(d=>d.alertLevel==='critical').length;
    const msg = total > 0
        ? `✅ ${total} dispositivos cargados${critical > 0 ? ` · 🔴 ${critical} críticos` : ''}`
        : '📂 Sin datos — importa un CSV para comenzar';
    Toast.show(msg, total > 0 ? 'success' : 'info');

    SaveManager.markSaved();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

document.querySelectorAll('.modal').forEach(m=>{ m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('active'); }); });
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') { document.querySelectorAll('.modal.active').forEach(m=>m.classList.remove('active')); }
  if(e.key === '?' && !e.target.matches('input,textarea,select')) { document.getElementById('kbdHint')?.classList.toggle('show'); }
  if(e.key === '/' && !e.target.matches('input,textarea,select')) { e.preventDefault(); document.getElementById('searchInput')?.focus(); }
  if(e.key === '1' && !e.target.matches('input,textarea,select')) { document.querySelector('.sidebar-item[data-tab="monitor"]')?.click(); }
  if(e.key === '2' && !e.target.matches('input,textarea,select')) { document.querySelector('.sidebar-item[data-tab="support"]')?.click(); }
  if(e.key === '3' && !e.target.matches('input,textarea,select')) { document.querySelector('.sidebar-item[data-tab="history"]')?.click(); }
  if(e.key === '4' && !e.target.matches('input,textarea,select')) { document.querySelector('.sidebar-item[data-tab="charts"]')?.click(); }
});


// ==================== SAVE MANAGER ====================
// ── Cloud sync helper: force pull latest from Firestore ──
async function forceSyncFromCloud() {
    if (!window._fb || !currentUser) { Toast.show('Sin conexión a Firebase', 'warning'); return; }
    if (!_app) return;
    Toast.show('🔄 Sincronizando desde la nube...', 'info', 2000);
    await _app._syncFromFirestore();
}
window.forceSyncFromCloud = forceSyncFromCloud;

const SaveManager = {
    _unsaved: false,
    _lastSaved: null,
    markUnsaved() {
        this._unsaved = true;
        const ind = document.getElementById('saveIndicator');
        const dot = document.getElementById('saveDot');
        const txt = document.getElementById('saveIndicatorText');
        if(ind) ind.className = 'save-indicator unsaved';
        if(dot) dot.classList.add('pulsing');
        if(txt) txt.textContent = 'Cambios sin guardar';
    },
    markSaved() {
        this._unsaved = false;
        this._lastSaved = new Date();
        const ind = document.getElementById('saveIndicator');
        const dot = document.getElementById('saveDot');
        const txt = document.getElementById('saveIndicatorText');
        const btn = document.getElementById('manualSaveBtn');
        if(ind) ind.className = 'save-indicator saved';
        if(dot) dot.classList.remove('pulsing');
        const t = this._lastSaved.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        if(txt) txt.textContent = `Guardado ${t}`;
        if(btn){ btn.className='save-btn saved'; btn.textContent='✅ Guardado'; setTimeout(()=>{ btn.className='save-btn'; btn.innerHTML='💾 Guardar'; },2500); }
    },
    isUnsaved() { return this._unsaved; }
};

// Guardar inmediatamente al cerrar/recargar página
window.addEventListener('beforeunload', (e) => {
    if(_app) _app.saveNow();
});

// Autosave cada 60 segundos
setInterval(() => {
    if(_app && SaveManager.isUnsaved()) {
        _app.saveNow();
        Toast.show('💾 Autosave completado', 'info', 2000);
    }
}, 60000);

// Botón SAVE manual
document.getElementById('manualSaveBtn')?.addEventListener('click', () => {
    if(!_app) return;
    const btn = document.getElementById('manualSaveBtn');
    btn.className = 'save-btn saving';
    btn.textContent = '⏳ Guardando...';
    setTimeout(() => {
        _app.saveNow();
    }, 100);
});

// Guardar también al cambiar a pestaña background (visibilitychange)
document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'hidden' && _app) _app.saveNow();
});

renderLoginScreen();
