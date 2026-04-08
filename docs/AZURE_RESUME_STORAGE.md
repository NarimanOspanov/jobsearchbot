# Azure Resume Storage Setup

This project stores uploaded user resumes in Azure Blob Storage container `resumes`.

## Required environment variable

Set:

`AZURE_STORAGE_CONNECTION_STRING=<your-storage-connection-string>`

## Azure Portal steps

1. Open your Storage Account in Azure Portal.
2. Go to `Access keys`.
3. Copy one of the connection strings.
4. Set `AZURE_STORAGE_CONNECTION_STRING`:
   - local `.env` for development
   - App Service -> `Configuration` -> `Application settings` for production
5. Restart the app.

## Runtime behavior

- Container name is fixed: `resumes`.
- The app creates the container automatically on first successful upload.
- On re-upload, old blobs are kept; only `Users.ResumeURL` is updated to the latest blob URL.
- For tailored CV files generated per application, use container `tailoredresumes` and save URL in `Applications.TailoredCVURL`.
