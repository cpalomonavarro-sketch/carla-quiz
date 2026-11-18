# Carla: cómo publicarlo gratis

## 1. Subir los archivos a GitHub
1. Crea una cuenta gratuita en https://github.com
2. Pulsa **New repository**, nómbralo `carla-quiz`, déjalo en **Public** y pulsa **Create repository**.
3. Pulsa **uploading an existing file** y arrastra TODO el contenido de esta carpeta
   (server.js, package.json, package-lock.json, questions.json y la carpeta public).
4. Pulsa **Commit changes**.

## 2. Publicarlo en Render
1. Entra en https://render.com y regístrate con tu cuenta de GitHub.
2. Pulsa **New + → Web Service** y elige el repositorio `carla-quiz`.
3. Rellena:
   - Language/Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
4. En **Environment Variables** añade `ADMIN_PASSWORD` con la contraseña que quieras para presentar.
5. Pulsa **Create Web Service** y espera 2-3 minutos. Tendrás una dirección tipo
   `https://carla-quiz.onrender.com`.

## 3. Jugar
- **Tú (presentador):** abre `https://TU-DIRECCION.onrender.com/presentar` en el ordenador del proyector
  e introduce la contraseña. Saldrán el QR y el PIN.
- **Alumnos:** escanean el QR (o entran en la dirección y escriben el PIN), ponen su nombre y juegan.

## Importante
- El plan gratuito "se duerme" tras 15 minutos sin uso: abre `/presentar` unos minutos antes de la clase.
- No cambies nada en GitHub durante una partida (Render se reinicia y se pierde la partida en curso).
- Para cambiar las preguntas, edita `questions.json` en GitHub (`c` = posición de la respuesta correcta,
  empezando en 0: 0=A, 1=B, 2=C, 3=D). Render se actualiza solo en un par de minutos.
- Si no pones ADMIN_PASSWORD, la contraseña por defecto es `carla`.
