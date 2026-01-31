export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  historyId: string;
  internalDate: string;
  payload: {
    headers: GmailHeader[];
    body: {
      size: number;
      data?: string;
    };
  };
}

export interface EnrichedMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  timestamp: number;
  selected: boolean;
  isRecovered: boolean;
  aiReasoning?: string;
  aiScore?: number; // 0-100, probability of being important
  labelIds: string[];
}

export enum AppState {
  AUTH_REQUIRED,
  SELECT_LABEL,
  LOADING_EMAILS,
  REVIEW_EMAILS,
  PROCESSING_RECOVERY
}