import { GmailLabel, GmailMessage, EnrichedMessage } from '../types';

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const SCOPES = 'https://www.googleapis.com/auth/gmail.modify';

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

const TOKEN_KEY = 'gmail_access_token';

const saveToken = (token: any) => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      ...token,
      expiry: Date.now() + (token.expires_in * 1000)
    }));
  }
};

const getPersistedToken = () => {
  const stored = localStorage.getItem(TOKEN_KEY);
  if (!stored) return null;
  const token = JSON.parse(stored);
  // Check if token is still valid (with a 5 min buffer)
  if (Date.now() > token.expiry - 300000) {
    localStorage.removeItem(TOKEN_KEY);
    return null;
  }
  return token;
};

// Just load the scripts, don't init the client yet
export const loadGoogleScripts = (
  onLoad: () => void,
) => {
  const checkReady = () => {
    if (gapiInited && gisInited) {
      onLoad();
    }
  };

  const gapiLoaded = () => {
    window.gapi.load('client', async () => {
      await window.gapi.client.init({
        discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'],
      });
      gapiInited = true;
      checkReady();
    });
  };

  const gisLoaded = () => {
    gisInited = true;
    checkReady();
  };

  // Load GAPI
  if (typeof window.gapi !== 'undefined') {
    gapiLoaded();
  } else {
    const interval = setInterval(() => {
      if (typeof window.gapi !== 'undefined' && !gapiInited) {
        gapiLoaded();
        clearInterval(interval);
      }
    }, 500);
  }

  // Load GIS
  if (typeof window.google !== 'undefined') {
    gisLoaded();
  } else {
    const interval = setInterval(() => {
      if (typeof window.google !== 'undefined' && !gisInited) {
        gisLoaded();
        clearInterval(interval);
      }
    }, 500);
  }
};

export const initTokenClient = (clientId: string) => {
  if (!window.google) throw new Error("Google Identity Services not loaded yet");

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => { }, // Initial dummy callback, overridden in handleAuthClick
  });
};

export const handleAuthClick = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("Auth client not initialized. Please provide a Client ID first."));
      return;
    }

    tokenClient.callback = async (resp: any) => {
      if (resp.error) {
        reject(resp);
      }
      // CRITICAL: Set the token in GAPI so subsequent calls are authenticated
      window.gapi.client.setToken(resp);
      saveToken(resp);
      resolve();
    };

    const existingToken = getPersistedToken();
    if (existingToken) {
      window.gapi.client.setToken(existingToken);
      resolve();
      return;
    }

    if (window.gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  });
};

export const listLabels = async (): Promise<GmailLabel[]> => {
  try {
    const response = await window.gapi.client.gmail.users.labels.list({
      userId: 'me',
    });
    return response.result.labels || [];
  } catch (err) {
    console.error('Error listing labels', err);
    throw err;
  }
};

export const listMessages = async (labelId: string, maxResults: number = 500, afterDate?: string, beforeDate?: string): Promise<GmailMessage[]> => {
  try {
    let queryParts = [];
    if (afterDate) queryParts.push(`after:${afterDate}`);
    if (beforeDate) queryParts.push(`before:${beforeDate}`);
    const query = queryParts.join(' ');

    // 1. Get IDs
    const response = await window.gapi.client.gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      maxResults: maxResults,
      q: query
    });

    const messages = response.result.messages;
    if (!messages || messages.length === 0) return [];

    // 2. Batch fetch details
    // GAPI batching is a bit complex in JS client, doing Promise.all chunks is often safer/easier for small batches
    const enrichedMessages: GmailMessage[] = [];
    const chunkSize = 10;

    for (let i = 0; i < messages.length; i += chunkSize) {
      const chunk = messages.slice(i, i + chunkSize);
      const promises = chunk.map((msg: any) =>
        window.gapi.client.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        })
      );

      const results = await Promise.all(promises);
      results.forEach((res: any) => {
        const msg = res.result as GmailMessage;
        enrichedMessages.push(msg);
      });
    }

    return enrichedMessages;
  } catch (err) {
    console.error('Error listing messages', err);
    throw err;
  }
};

export const parseMessage = (msg: GmailMessage): EnrichedMessage => {
  const headers = msg.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
  const from = headers.find(h => h.name === 'From')?.value || '(Unknown)';
  const dateStr = headers.find(h => h.name === 'Date')?.value || '';
  const timestamp = parseInt(msg.internalDate);
  const formattedDate = new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return {
    id: msg.id,
    subject,
    from,
    date: formattedDate,
    snippet: msg.snippet,
    timestamp: timestamp,
    selected: false,
    isRecovered: false,
    labelIds: msg.labelIds || []
  };
};

export const moveToInbox = async (messageIds: string[]): Promise<void> => {
  try {
    await window.gapi.client.gmail.users.messages.batchModify({
      userId: 'me',
      ids: messageIds,
      addLabelIds: ['INBOX'],
    });
  } catch (err) {
    console.error('Error moving to inbox', err);
    throw err;
  }
};