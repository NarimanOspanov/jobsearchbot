import { BlobServiceClient } from '@azure/storage-blob';
import { config } from '../config.js';

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
  const resumeContainerName = config.azureResumeContainerName || 'resumes';
  const tailoredContainerName = config.azureTailoredResumeContainerName || 'tailoredresumes';

  async function uploadToContainer(containerName, { folder, fileId, fileName, mimeType, buffer }) {
    if (!connectionString) {
      throw new Error('AZURE_STORAGE_CONNECTION_STRING is not configured.');
    }
    const client = BlobServiceClient.fromConnectionString(connectionString);
    const container = client.getContainerClient(containerName);
    await container.createIfNotExists();

    const safeFolder = sanitizeSegment(folder);
    const safeFileId = sanitizeSegment(fileId);
    const ext = (fileName && fileName.includes('.'))
      ? sanitizeSegment(fileName.split('.').pop())
      : extensionFromMime(mimeType);
    const blobName = `telegram/${safeFolder}/${Date.now()}-${safeFileId}.${ext}`;
    const blob = container.getBlockBlobClient(blobName);

    await blob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: mimeType || 'application/octet-stream' },
    });
    return blob.url;
  }

  async function uploadResumeBuffer({ chatId, fileId, fileName, mimeType, buffer }) {
    return uploadToContainer(resumeContainerName, {
      folder: chatId,
      fileId,
      fileName,
      mimeType,
      buffer,
    });
  }

  async function uploadTailoredResumeBuffer({ seekerId, screenlyJobId, fileName, mimeType, buffer }) {
    return uploadToContainer(tailoredContainerName, {
      folder: `${seekerId}-${screenlyJobId}`,
      fileId: `${seekerId}-${screenlyJobId}-${Date.now()}`,
      fileName: fileName || `tailored-${screenlyJobId}.pdf`,
      mimeType: mimeType || 'application/pdf',
      buffer,
    });
  }

  return { uploadResumeBuffer, uploadTailoredResumeBuffer };
}

export const resumeStorage = createResumeStorage(config);
