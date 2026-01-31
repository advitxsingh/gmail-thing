import { GoogleGenAI, Type } from "@google/genai";
import { EnrichedMessage } from "../types";

// NOTE: In a real production app, you should proxy these requests through a backend
// to avoid exposing the API key if it's not restricted to a specific domain.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeEmailsImportance = async (
  emails: EnrichedMessage[],
  userContext: string
): Promise<{ id: string; score: number; reasoning: string }[]> => {

  // Create a lightweight representation to save tokens
  const emailData = emails.map(e => ({
    id: e.id,
    from: e.from,
    subject: e.subject,
    snippet: e.snippet.substring(0, 100) // Truncate snippet
  }));

  const prompt = `
    You are an expert at identifying "Inbox-worthy" emails that were accidentally archived.
    
    User's specific context: "${userContext}"
    
    CRITERIA for 100 Score (Recover to Inbox):
    - Personal correspondence from real people.
    - Important business/work threads.
    - Active bills, invoices, or receipts from the last month.
    - Travel bookings (flights, hotels).
    
    CRITERIA for 0 Score (Keep Archived):
    - Promotional newsletters and marketing.
    - Social media notifications (LinkedIn, Twitter, etc).
    - Automated system logs or generic alerts.
    - "No-reply" emails that aren't transactional.
    
    Return a JSON array of objects with {id, score, reasoning}.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { role: "user", parts: [{ text: prompt }] },
        { role: "user", parts: [{ text: JSON.stringify(emailData) }] }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              score: { type: Type.NUMBER },
              reasoning: { type: Type.STRING }
            }
          }
        }
      }
    });

    const result = JSON.parse(response.text || "[]");
    return result;
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return [];
  }
};
