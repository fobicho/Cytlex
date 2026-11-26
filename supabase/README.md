# Configuración de Supabase para Cytlex

1. Crea un proyecto de Supabase y abre **SQL Editor**.
2. Ejecuta las migraciones de `migrations/` en orden.
3. En **Authentication → Providers**, activa Email. Configura la confirmación por correo y SMTP según el flujo de registro que quieras ofrecer. Define la URL del sitio del proyecto y las URL de redirección permitidas con los orígenes de la aplicación web.
4. Copia la URL del proyecto y la clave **publishable** (o la clave heredada `anon`) a un archivo `.env` local. Usa `.env.example` como plantilla:

   ```dotenv
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

5. Reinicia el servidor de desarrollo de Vite o vuelve a compilar y desplegar la aplicación después de configurar las variables. Para las compilaciones desplegadas, define las mismas variables en el entorno de compilación del proveedor de alojamiento.

Nunca incluyas una clave `service_role` ni una clave secreta en estas variables o en la aplicación cliente. La migración restringe cada usuario autenticado a su propia fila de sincronización mediante seguridad a nivel de fila (RLS); los datos de la cuenta se guardan en una única instantánea JSON. Se sincronizan los favoritos, las categorías, el progreso de lectura y los ID y versiones de las extensiones instaladas. Las credenciales de extensiones, los repositorios personalizados, las cachés y las preferencias visuales permanecen en el dispositivo. En otro dispositivo, las extensiones se restauran desde el repositorio configurado allí, siempre que estén disponibles el mismo ID y la misma versión.

La aplicación consulta los datos de la cuenta al iniciar y permite cargarlos o guardar los datos locales desde Cuenta. Los cambios locales no se envían automáticamente. Las solicitudes a las fuentes de manga siguen usando el flujo existente de fuentes y proxy de Cytlex.
