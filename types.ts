
export interface StudyDefinition {
  cpt: string;
  name: string;
  rvu: number;
  category: 'X-Ray' | 'CT' | 'MRI' | 'Ultrasound' | 'Nuclear Medicine' | 'Interventional' | 'Other';
}

export interface ScannedStudy {
  id: string;
  cpt: string;
  name: string;
  rvu: number;
  quantity: number;
  confidence: number;
  originalText?: string;
}

export interface CalculationResults {
  totalRVU: number;
  totalEarnings: number;
  studyCount: number;
}
