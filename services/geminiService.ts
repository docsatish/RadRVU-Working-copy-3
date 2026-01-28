
import { GoogleGenAI, Type } from "@google/genai";
import { StudyDefinition } from "../types";

export const performOCRAndMatch = async (base64Image: string, currentDb: StudyDefinition[]) => {
  // Initialization following world-class senior engineer standards and SDK rules
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
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

    // Use ai.models.generateContent to query GenAI with both the model name and prompt.
    // Updated contents to a single object with parts as per current SDK guidelines.
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: rawImageData } },
          { text: "Extract all radiology procedures individually. Do not combine them. Return as JSON." }
        ]
      },
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

    // Directly access the .text property per SDK rules (it's a getter, not a method)
    const jsonStr = response.text || '{"studies": []}';
    const data = JSON.parse(jsonStr);
    
    return data.studies || [];
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    return [];
  }
};
