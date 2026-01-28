import { GoogleGenAI, Type } from "@google/genai";
import { StudyDefinition } from "../types";

export const performOCRAndMatch = async (base64Image: string, currentDb: StudyDefinition[]) => {
  // --- 1. THE API KEY FIX ---
  // In Netlify/Vite, you MUST use import.meta.env.VITE_... 
  // process.env is usually undefined in the browser.
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.API_KEY;

  if (!apiKey) {
    console.error("No API key found. Check Netlify Environment Variables for VITE_GEMINI_API_KEY.");
    return [];
  }

  const ai = new GoogleGenAI({ apiKey });
  
  const studyListForContext = currentDb.map(s => `NAME: ${s.name} | CPT: ${s.cpt}`).join('\n');

  const systemInstruction = `
    You are an expert Radiology Medical Coder. 
    1. Extract every individual radiology procedure listed in the image. 
    2. DO NOT aggregate or combine procedures; if you see "CT Head" 3 times, return 3 separate entries.
    3. Match each extracted entry to the closest procedure in the REFERENCE LIST.
    
    REFERENCE LIST:
    ${studyListForContext}
    
    OUTPUT: JSON only with a "studies" array.
  `;

  try {
    const rawImageData = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

    // --- 2. SDK STRUCTURE FIX ---
    // 'contents' must be an ARRAY of objects, and the model should be a stable version.
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash', // Most reliable for OCR + Schema tasks right now
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: rawImageData } },
            { text: "Extract all radiology procedures individually. Return as JSON." }
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
                  quantity: { type: Type.NUMBER },
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

    const jsonStr = response.text; // .text is a getter, correct.
    const data = JSON.parse(jsonStr || '{"studies": []}');
    
    return data.studies || [];
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    return [];
  }
};