import { OBJECTIVES, MODALITIES, SENSORS, TEMPLATE_ID, ZONES, requiredModalities, type Modality } from './metadata';

/** Private planning input. Not a canonical Mission, event, financial command or authorization. */
export interface DraftInput {
  title: string; templateId: string; objective: string; zoneIds: string[];
  sensors: Record<Modality,string[]>;
  minCoverage: string; minQuality: string; waterEvidence: string; budgetSol: string;
}
export type Errors = Record<string,string>;
export const FIELD_STEPS: Record<string,number> = { title:0, objective:0, template:0, zones:1, machines:2, minCoverage:3, minQuality:3, waterEvidence:3, budgetSol:3 };
export const LIMITS = { records:20, bytes:131072, maxSol:'1000000' };
export function emptyInput(): DraftInput { return { title:'',templateId:TEMPLATE_ID,objective:'combined',zoneIds:[],sensors:{air:[],land:[],water:[]},minCoverage:'90',minQuality:'70',waterEvidence:'sonar',budgetSol:'' }; }
export function sensitiveTitle(title: string) {
  return /private[ _-]?key|seed[ -]?phrase|mnemonic|api[ _-]?key|password|bearer\s|BEGIN.*PRIVATE|sk-[a-z0-9]{16}|0x[a-f0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,88}/i.test(title) || [12,24].includes(title.trim().split(/\s+/).filter(Boolean).length);
}
export function parseSol(value: string): string {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,9})?$/.test(value)) throw new Error('Enter a positive SOL amount with up to 9 decimal places; no signs, commas or exponent notation.');
  const [whole, decimal = ''] = value.split('.');
  const lamports = BigInt(whole!) * 1000000000n + BigInt(decimal.padEnd(9,'0'));
  if (lamports <= 0n || lamports > 1000000000000000n) throw new Error('Proposed budget must be greater than zero and no more than 1,000,000 SOL.');
  return lamports.toString();
}
export function validate(input: DraftInput): Errors {
  const errors: Errors = {};
  if (!input.title.trim()) errors.title = 'Name this draft so you can find it later.';
  else if (input.title.length > 80) errors.title = 'Use no more than 80 characters.';
  else if (sensitiveTitle(input.title)) errors.title = 'This title may contain sensitive information. Use a short fictional planning name; nothing will be saved until it is changed.';
  if (input.templateId !== TEMPLATE_ID) errors.template = 'Choose the supported fictional port template.';
  if (!OBJECTIVES.some(o => o.id === input.objective)) errors.objective = 'Choose a supported inspection objective.';
  const modalities = requiredModalities(input.zoneIds);
  if (!input.zoneIds.length || new Set(input.zoneIds).size !== input.zoneIds.length || input.zoneIds.some(id => !ZONES.some(z => z.id === id))) errors.zones = 'Select at least one supported, distinct port region.';
  const required = ({aerial:'air',ground:'land',submerged:'water'} as Record<string,string>)[input.objective];
  if (required && (!modalities.includes(required as Modality) || modalities.some(m => m !== required))) errors.zones = 'Choose regions that match this objective, or switch to a multi-domain inspection.';
  for (const modality of MODALITIES) {
    const selected = input.sensors[modality];
    if (selected.some(s => !SENSORS[modality].some(option => option.id === s)) || new Set(selected).size !== selected.length) errors.machines = 'A sensor is incompatible with its machine class.';
    if (modalities.includes(modality) && !selected.length) errors.machines = 'Choose at least one capability for each selected environment.';
    if (modality === 'land' && modalities.includes('land') && !selected.includes('route-mapping')) errors.machines = 'Ground access inspection requires route mapping.';
    if (modality === 'water' && input.objective === 'submerged' && !selected.includes('sonar')) errors.machines = 'The submerged obstruction objective requires a sonar-capable ROV.';
  }
  for (const field of ['minCoverage','minQuality'] as const) if (!/^(?:[1-9]\d?|100)$/.test(input[field])) errors[field] = 'Use a whole percentage from 1 to 100.';
  if (!['optical','sonar'].includes(input.waterEvidence) || (modalities.includes('water') && (!input.sensors.water.includes(input.waterEvidence) || (input.objective === 'submerged' && input.waterEvidence !== 'sonar')))) errors.waterEvidence = 'The underwater evidence method must match a selected sensor and the inspection objective.';
  try { parseSol(input.budgetSol); } catch(error) { errors.budgetSol = (error as Error).message; }
  return errors;
}
export function stepErrors(input: DraftInput, step: number) { return Object.fromEntries(Object.entries(validate(input)).filter(([field]) => FIELD_STEPS[field] === step)); }

const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string,unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(key => key in v);
const strings = (v: unknown, count: number, length: number): v is string[] => Array.isArray(v) && v.length <= count && v.every(s => typeof s === 'string' && s.length <= length);
export function isInput(value: unknown): value is DraftInput {
  if (!object(value) || !exactKeys(value,['title','templateId','objective','zoneIds','sensors','minCoverage','minQuality','waterEvidence','budgetSol'])) return false;
  if (!['title','templateId','objective','minCoverage','minQuality','waterEvidence','budgetSol'].every(key => typeof value[key] === 'string' && (value[key] as string).length <= (key === 'title' ? 80 : 32))) return false;
  if (!strings(value.zoneIds, ZONES.length, 64) || value.zoneIds.some(id => !ZONES.some(z => z.id === id)) || new Set(value.zoneIds).size !== value.zoneIds.length) return false;
  if (value.templateId !== TEMPLATE_ID || !OBJECTIVES.some(o => o.id === value.objective) || !['optical','sonar'].includes(value.waterEvidence as string)) return false;
  const sensors = value.sensors;
  return object(sensors) && exactKeys(sensors, MODALITIES) && MODALITIES.every(m => strings(sensors[m],3,32) && (sensors[m] as string[]).every(s => SENSORS[m].some(option => option.id === s)) && new Set(sensors[m] as string[]).size === (sensors[m] as string[]).length) && !sensitiveTitle(value.title as string);
}
export function budgetOf(input: DraftInput) { try { return parseSol(input.budgetSol); } catch { return null; } }
