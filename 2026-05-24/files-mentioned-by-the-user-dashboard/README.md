# NEOMEDIA Digital Dashboard

Dashboard web para monitoreo operativo, tickets, historial, reportes y asistente IA.

## Estructura

- `public/index.html`: pagina principal.
- `public/assets/styles.css`: estilos.
- `public/assets/firebase-init.js`: inicializacion Firebase.
- `public/assets/app.js`: logica del dashboard.
- `api/ai.js`: proxy serverless para IA.
- `vercel.json`: configuracion de hosting, rewrites y headers.
- `firebase.rules.example`: reglas base para Firestore.

## Desarrollo local

```bash
npm install
npm run check
npm run dev
```

`npm run dev` usa Vercel Dev para probar tambien `/api/ai`.

## Despliegue en Vercel

1. Sube esta carpeta a GitHub.
2. En Vercel, crea un proyecto e importa el repositorio.
3. Framework preset: `Other`.
4. Output/static directory: `public`.
5. Agrega variables de entorno:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` opcional, por defecto `gpt-5-mini`
6. Deploy.

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
