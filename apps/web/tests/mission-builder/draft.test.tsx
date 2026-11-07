import { describe, expect, it } from 'vitest';
import { parseSol, emptyInput, validate } from '../../lib/workspace-draft/schema';
import { createRepository, STORAGE_KEY } from '../../lib/workspace-draft/storage';
import { ZONES } from '../../lib/workspace-draft/metadata';

describe('exact planning budgets', () => {
  it('retains one-lamport precision without floating point', () => {
    expect(parseSol('0.000000001')).toBe('1');
    expect(parseSol('123456.123456789')).toBe('123456123456789');
  });
  it.each(['0', '-1', 'NaN', 'Infinity', '1e3', '0.0000000001', '1000000.000000001', '999999999999999999', '1.'])('rejects %s', value => expect(() => parseSol(value)).toThrow());
});

export function validInput(title = 'Basin survey') {
  return { ...emptyInput(), title, zoneIds: ['underwater_inspection'], sensors: { air: [], land: [], water: ['sonar'] }, budgetSol: '2.000000001' };
}
function harness() {
  const memory = new Map<string,string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key,value); }, removeItem: (key: string) => { memory.delete(key); } };
  let queue = Promise.resolve();
  const lock = <T,>(operation: () => T): Promise<T> => { const result = queue.then(operation); queue = result.then(() => undefined, () => undefined); return result; };
  return { memory, repo: createRepository(storage, lock) };
}

describe('private local repository', () => {
  it('saves distinct A/B drafts, edits A, rejects stale writes, and deletes only A', async () => {
    const { repo } = harness();
    const a = await repo.save({ id: crypto.randomUUID(), input: validInput('Mission A'), step: 4, complete: true }, 0);
    const b = await repo.save({ id: crypto.randomUUID(), input: { ...validInput('Mission B'), budgetSol: '7.5' }, step: 4, complete: true }, 0);
    expect(repo.read()).toHaveLength(2);
    const edited = await repo.save({ ...a, input: { ...a.input, title: 'Mission A edited' } }, a.revision);
    await expect(repo.save(a, a.revision)).rejects.toThrow(/another tab/i);
    expect(repo.read().find(d => d.id === b.id)?.input.budgetSol).toBe('7.5');
    await repo.remove(edited.id, edited.revision);
    expect(repo.read().map(d => d.id)).toEqual([b.id]);
  });
  it('is idempotent for repeated identical saves', async () => {
    const { repo } = harness();
    const command = { id: crypto.randomUUID(), input: validInput(), step: 4, complete: true };
    const a = await repo.save(command, 0);
    const b = await repo.save(command, a.revision);
    expect(b.revision).toBe(a.revision);
    expect(repo.read()).toHaveLength(1);
  });
  it('serializes racing stale writes', async () => {
    const { repo } = harness(); const a = await repo.save({ id: crypto.randomUUID(), input: validInput(), step: 0, complete: false },0);
    const results = await Promise.allSettled(['One','Two'].map(title => repo.save({ ...a,input:{...a.input,title} },a.revision)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it.each(['{broken', '{"version":99,"drafts":[]}'])('blocks corrupt or future storage without overwriting it', async raw => {
    const { memory, repo } = harness();memory.set(STORAGE_KEY,raw);
    expect(() => repo.read()).toThrow();
    await expect(repo.save({ id:crypto.randomUUID(), input:validInput(),step:0,complete:false },0)).rejects.toThrow();
    expect(memory.get(STORAGE_KEY)).toBe(raw);
    await repo.reset();expect(repo.read()).toEqual([]);
  });
  it('blocks sensitive-looking titles before storing any bytes', async () => {
    const { repo, memory } = harness();
    await expect(repo.save({ id:crypto.randomUUID(), input:validInput('private key: example'),step:0,complete:false },0)).rejects.toThrow(/sensitive/i);
    expect(memory.size).toBe(0);
  });
});

describe('planning validation', () => {
  it('rejects missing title, unknown zones and incompatible sensors', () => {
    expect(validate({ ...validInput(), title:'   ' }).title).toBeTruthy();
    expect(validate({ ...validInput(), zoneIds:['invented'] }).zones).toBeTruthy();
    expect(validate({ ...validInput(), sensors:{air:['sonar'],land:[],water:[]} }).machines).toBeTruthy();
  });
  it('rejects contradictory evidence requirements and exact threshold violations', () => {
    expect(validate({ ...validInput(), sensors:{air:[],land:[],water:['optical']} }).waterEvidence).toBeTruthy();
    expect(validate({ ...validInput(), minCoverage:'101' }).minCoverage).toBeTruthy();
  });
  it('uses actual port metadata without exposing other templates', () => {
    expect(ZONES.some(z => z.id === 'pier_c_deck' && z.damaged)).toBe(true);
    expect(validate(validInput())).toEqual({});
  });
});
