import { GmailLabel, EnrichedMessage, ScanResult } from '../types';

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

const parseToTimestamp = (dateStr?: string): number => {
  if (!dateStr) return 0;
  if (/^\d+$/.test(dateStr)) return parseInt(dateStr);
  return Math.floor(new Date(dateStr.replace(/\//g, '-')).getTime() / 1000);
};

const getHistoryIdAtTime = async (timestamp: number, isStart: boolean): Promise<string | null> => {
  try {
    // Search for a message around this time. For the start, we want a message BEFORE.
    // For the end, we want a message AFTER.
    const query = isStart ? `before:${timestamp}` : `after:${timestamp}`;
    const response = await window.gapi.client.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 1
    });

    const messages = response.result.messages;
    if (messages && messages.length > 0) {
      const msg = await window.gapi.client.gmail.users.messages.get({
        userId: 'me',
        id: messages[0].id,
        format: 'minimal'
      });
      return msg.result.historyId;
    }

    // If no message found, the mailbox was likely idle. 
    // Fallback: Get the current profile history ID
    const profile = await window.gapi.client.gmail.users.getProfile({ userId: 'me' });
    return profile.result.historyId;
  } catch (err) {
    console.error('Error getting historyId anchor', err);
    return null;
  }
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

export const listMessages = async (labelId: string, labelName: string, maxResults: number = 30000, afterDate?: string, beforeDate?: string): Promise<ScanResult> => {
  try {
    const afterTs = parseToTimestamp(afterDate);
    const beforeTs = parseToTimestamp(beforeDate) || Math.floor(Date.now() / 1000);
    const isWithinHistoryLimit = afterTs > (Date.now() / 1000) - (6 * 24 * 3600);

    let targetMessageIds = new Set<string>();
    let historyFoundIds = new Set<string>();
    let startHistoryId: string | null = null;
    let endHistoryId: string | null = null;
    const actionHistoryMap = new Map<string, string>();
    let usedHistory = false;

    // SCENARIO 1: ACTION LOG SCAN (When Label was Added)
    if (isWithinHistoryLimit && afterTs > 0) {
      startHistoryId = await getHistoryIdAtTime(afterTs, true);
      endHistoryId = await getHistoryIdAtTime(beforeTs, false);

      if (startHistoryId) {
        try {
          let pageToken = undefined;
          let stopScanning = false;

          do {
            const historyRes = await window.gapi.client.gmail.users.history.list({
              userId: 'me',
              startHistoryId: startHistoryId,
              pageToken: pageToken,
              historyTypes: ['labelAdded']
            });

            const historyRecords = historyRes.result.history;
            if (historyRecords) {
              for (const record of historyRecords) {
                // IMPORTANT: Use BigInt for 64-bit History IDs to avoid bit-mangle bugs
                const currentId = BigInt(record.id);
                const endId = endHistoryId ? BigInt(endHistoryId) : null;

                if (endId && currentId > endId) {
                  stopScanning = true;
                  break;
                }

                if (record.labelsAdded) {
                  record.labelsAdded.forEach((la: any) => {
                    if (la.labelIds.includes(labelId)) {
                      targetMessageIds.add(la.message.id);
                      historyFoundIds.add(la.message.id);
                      actionHistoryMap.set(la.message.id, record.id);
                    }
                  });
                }
              }
            }
            pageToken = historyRes.result.nextPageToken;
          } while (pageToken && !stopScanning);
          usedHistory = true;
          console.log(`History scan complete. Found ${targetMessageIds.size} message actions.`);
        } catch (hErr) {
          console.warn('History API error, falling back to standard search:', hErr);
          usedHistory = false;
        }
      }
    }

    // SCENARIO 2: FALLBACK TO SEARCH
    let finalMessages: any[] = [];
    if (usedHistory && targetMessageIds.size > 0) {
      const idArray = Array.from(targetMessageIds).slice(0, maxResults);
      const chunkSize = 20;

      for (let i = 0; i < idArray.length; i += chunkSize) {
        const chunk = idArray.slice(i, i + chunkSize);
        const promises = chunk.map(id =>
          window.gapi.client.gmail.users.messages.get({
            userId: 'me',
            id: id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
          })
        );

        const results = await Promise.all(promises);
        results.forEach((res: any) => {
          const msg = res.result;
          if (msg.labelIds && msg.labelIds.includes(labelId)) {
            // Attach the action history ID we saved earlier
            msg.__actionHistoryId = actionHistoryMap.get(msg.id);
            finalMessages.push(msg);
          }
        });
      }
    } else if (!usedHistory || targetMessageIds.size === 0) {
      // Fallback: Standard search using label NAME
      const query = `label:"${labelName}" ${afterDate ? `after:${afterDate}` : ''} ${beforeDate ? `before:${beforeDate}` : ''}`;
      console.log(`Searching label by name: ${query}`);
      let allFoundMessages: any[] = [];
      let pageToken = undefined;

      do {
        const listResponse = await window.gapi.client.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: Math.min(500, maxResults - allFoundMessages.length),
          pageToken: pageToken
        });

        const pageMessages = listResponse.result.messages || [];
        allFoundMessages = [...allFoundMessages, ...pageMessages];
        pageToken = listResponse.result.nextPageToken;
      } while (pageToken && allFoundMessages.length < maxResults);

      const messages = allFoundMessages;
      const chunkSize = 20;
      for (let i = 0; i < messages.length; i += chunkSize) {
        const chunk = messages.slice(i, i + chunkSize);
        const detailPromises = chunk.map((m: any) =>
          window.gapi.client.gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
          })
        );
        const details = await Promise.all(detailPromises);
        details.forEach((res: any) => finalMessages.push(res.result));
      }
    }

    if (finalMessages.length === 0) return { messages: [] };

    // 2. Group by threadId
    const threadGroups = new Map<string, { representative: any, allIds: string[] }>();
    finalMessages.forEach((m: any) => {
      const tId = m.threadId;
      if (!threadGroups.has(tId)) {
        threadGroups.set(tId, { representative: m, allIds: [] });
      }
      threadGroups.get(tId)!.allIds.push(m.id);
    });

    const uniqueThreads = Array.from(threadGroups.values());
    const enrichedMessages: any[] = [];
    uniqueThreads.forEach((t: any) => {
      const msg = t.representative;
      msg.__allIds = t.allIds;
      // The __labelAddedAt will be interpolated in parseMessage using historyRange
      // if (historyFoundIds.has(msg.id)) {
      //   msg.__labelAddedAt = Date.now(); // Mark as found via history
      // }
      enrichedMessages.push(msg);
    });

    return {
      messages: enrichedMessages,
      historyRange: usedHistory && startHistoryId ? {
        startId: startHistoryId,
        endId: endHistoryId || Array.from(actionHistoryMap.values()).pop() || '0',
        startTime: afterTs,
        endTime: beforeTs
      } : undefined
    };
  } catch (err) {
    console.error('Error listing messages', err);
    throw err;
  }
};

export const parseMessage = (msg: any, historyRange?: { startId: string, endId: string, startTime: number, endTime: number }): EnrichedMessage => {
  const headers = msg.payload.headers;
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
  const from = headers.find((h: any) => h.name === 'From')?.value || '(Unknown)';
  const timestamp = parseInt(msg.internalDate);
  const formattedDate = new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  let labelAddedAt = msg.__labelAddedAt;

  // Interpolate time if we have history range and this was a history action
  if (msg.__actionHistoryId && historyRange && historyRange.startId !== historyRange.endId) {
    try {
      const sId = BigInt(historyRange.startId);
      const eId = BigInt(historyRange.endId);
      const mId = BigInt(msg.__actionHistoryId);

      if (mId >= sId && mId <= eId) {
        // Calculate progress using BigInt for precision
        const range = eId - sId;
        const progress = mId - sId;
        const ratio = Number(progress) / Number(range);

        labelAddedAt = (historyRange.startTime + (ratio * (historyRange.endTime - historyRange.startTime))) * 1000;
      }
    } catch (e) {
      console.warn('BigInt interpolation failed', e);
    }
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    allMessageIds: msg.__allIds || [msg.id],
    subject,
    from,
    date: formattedDate,
    snippet: msg.snippet,
    timestamp: timestamp,
    labelAddedAt,
    selected: false,
    isRecovered: false,
    labelIds: msg.labelIds || []
  };
};

export const moveToInbox = async (messageIds: string[], removeLabelId?: string): Promise<void> => {
  try {
    const params: any = {
      userId: 'me',
      ids: messageIds,
      addLabelIds: ['INBOX'],
    };

    if (removeLabelId && removeLabelId !== 'INBOX') {
      params.removeLabelIds = [removeLabelId];
    }

    await window.gapi.client.gmail.users.messages.batchModify(params);
  } catch (err) {
    console.error('Error moving to inbox', err);
    throw err;
  }
};