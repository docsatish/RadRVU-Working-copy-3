import { GoogleGenAI, Type } from "@google/genai";
import { StudyDefinition } from "../types";

export const performOCRAndMatch = async (base64Image: string, currentDb: StudyDefinition[]) => {
  // --- UNIVERSAL KEY FIX START ---
  let apiKey = '';
  try {
    // Vite/Netlify check
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
    }
  } catch (e) {
    // Fallback if import.meta is unsupported
  }

  // Google AI Studio fallback
  if (!apiKey) {
    apiKey = process.env.API_KEY || '';
  }

  if (!apiKey) {
    console.error("No API key found. Check Netlify Environment Variables.");
    return [];
  }
  // --- UNIVERSAL KEY FIX END ---

  const ai = new GoogleGenAI({ apiKey: apiKey });
  const studyListForContext = currentDb.map(s => `NAME: ${s.name} | CPT: ${s.cpt}`).join('\n');

  const systemInstruction = `
    You are an expert Radiology Medical Coder. 
    1. Extract every individual radiology procedure listed in the image. 
    2. DO NOT aggregate or combine procedures of the same type; if you see "CT Head" listed 3 times, return 3 separate entries.
    3. Match each extracted entry to the closest procedure in the REFERENCE LIST.
    
    REFERENCE LIST:
    ${studyListForContext}
    
    OUTPUT: JSON only with a "studies" array.
  `;

  try {
    const rawImageData = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash', // Switched to stable 2.0 for production reliability
      contents: [
        {
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: rawImageData } },
            { text: "Extract all radiology procedures individually. Do not combine them. Return as JSON." }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            studies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  cpt: { type: Type.STRING },
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER, description: "Set to 1 for each individual entry found." },
                  originalText: { type: Type.STRING },
                  confidence: { type: Type.NUMBER }
                },
                required: ["cpt", "name", "quantity", "originalText", "confidence"]
              }
            }
          }
        }
      }
    });

    // Directly access the .text property
    const data = JSON.parse(response.text || '{"studies": []}');
    return data.studies || [];
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    return [];
  }
};