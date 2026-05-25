# Despliegue e IA

## Objetivo

Esta version queda preparada para publicarse como aplicacion web:

- `public/` contiene el dashboard estatico.
- `api/ai.js` contiene el proxy seguro para IA.
- Firebase mantiene autenticacion y datos.
- Vercel sirve la web y ejecuta `/api/ai`.

## Proceso recomendado

1. Crear un repositorio en GitHub.
2. Subir esta carpeta completa.
3. Importar el repositorio en Vercel.
4. Configurar el proyecto como `Other`.
5. Confirmar que Vercel sirva `public/`.
6. Agregar variables de entorno:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` opcional.
7. Hacer deploy.
8. En Firebase Authentication, agregar el dominio generado por Vercel.
9. En Firestore, aplicar reglas basadas en `firebase.rules.example`.
10. Probar login, carga CSV, tickets, backup y asistente IA.

## Por que no poner la IA directo en el HTML

Una API key puesta en JavaScript del navegador queda visible para cualquier usuario. Por eso el dashboard llama a `/api/ai`; esa funcion vive en el servidor, lee `OPENAI_API_KEY` desde variables de entorno y devuelve solo la respuesta.

## Activar IA en el navegador

```js
localStorage.setItem('nm_ai_enabled', 'true');
localStorage.setItem('nm_ai_endpoint', '/api/ai');
```

Luego recarga la pagina.
