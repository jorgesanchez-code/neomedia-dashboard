# NEOMEDIA Digital Dashboard

Dashboard web para monitoreo operativo, tickets, historial, reportes y asistente IA.

## Estructura

- `public/index.html`: pagina principal.
- `public/assets/styles.css`: estilos.
- `public/assets/firebase-init.js`: inicializacion Firebase.
- `public/assets/app.js`: logica del dashboard.
- `index.html` y `assets/`: copia raiz para despliegues Vercel/estaticos que no usen `public/` como salida.
- `api/ai.js`: proxy serverless para IA.
- `vercel.json`: configuracion de hosting, rewrites y headers.
- `firebase.rules.example`: reglas base para Firestore.

## Desarrollo local

```bash
npm install
npm run check
npm run build
npm run dev
```

`npm run dev` usa Vercel Dev para probar tambien `/api/ai`.

## Despliegue en Vercel

1. Sube esta carpeta a GitHub.
2. En Vercel, crea un proyecto e importa el repositorio.
3. Framework preset: `Other`.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. Agrega variables de entorno:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` opcional, por defecto `gpt-5-mini`
7. Deploy.

Si aparece `404: NOT_FOUND`, revisa que el proyecto en Vercel apunte a la carpeta que contiene `package.json`, `index.html`, `assets/`, `api/` y `vercel.json`. Si este dashboard esta dentro de una subcarpeta del repositorio, esa subcarpeta debe ser el `Root Directory`.

## Firebase

En Firebase Console:

1. Authentication > Settings > Authorized domains.
2. Agrega el dominio de Vercel, por ejemplo `tu-proyecto.vercel.app`.
3. Firestore > Rules.
4. Usa `firebase.rules.example` como base y ajusta roles si cambias permisos.

## Activar IA real

La IA real se llama por `/api/ai`; la clave queda del lado servidor.

En el navegador:

```js
localStorage.setItem('nm_ai_enabled', 'true');
localStorage.setItem('nm_ai_endpoint', '/api/ai');
```

Luego recarga el dashboard.

## Checklist antes de produccion

- Verificar reglas Firestore.
- Verificar dominios autorizados en Firebase Auth.
- Crear usuarios iniciales desde un flujo controlado.
- Probar login, importacion CSV, tickets, backup y `/api/ai`.
- Configurar backups de Firestore.
