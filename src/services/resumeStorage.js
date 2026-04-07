import { BlobServiceClient } from '@azure/storage-blob';

function sanitizeSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extensionFromMime(mimeType) {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  return 'bin';
}

export function createResumeStorage(config) {
  const connectionString = config.azureStorageConnectionString || '';
  const containerName = config.azureResumeContainerName || 'resumes';

  async function uploadResumeBuffer({ chatId, fileId, fileName, mimeType, buffer }) {
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured.');
    }
    const client = BlobServiceClient.fromConnectionString(connectionString);
    const container = client.getContainerClient(containerName);
    await container.createIfNotExists();

    const safeChatId = sanitizeSegment(chatId);
    const safeFileId = sanitizeSegment(fileId);
    const ext = (fileName && fileName.includes('.'))
      ? sanitizeSegment(fileName.split('.').pop())
      : extensionFromMime(mimeType);
    const blobName = `telegram/${safeChatId}/${Date.now()}-${safeFileId}.${ext}`;
    const blob = container.getBlockBlobClient(blobName);

    await blob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType || 'application/octet-stream' },
    });
    return blob.url;
  }

  return { uploadResumeBuffer };
}
