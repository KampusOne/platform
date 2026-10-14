import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateAcademicImport } from './academic-import-recovery';
import { prepareTimetableImage, webpDimensions } from './webp-pixels';
import { timetableImageRows, timetableLayoutImage } from './timetable-image-grid';
const slots = [{ startsAt: '08:00', endsAt: '09:00' }, { startsAt: '09:00', endsAt: '10:00' }];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const layout = { documentType: 'class_timetable', entries: [], events: [], grid: { timeSlots: slots, levels: ['100', '200'], daysSeen: [1, 2], rows: [] }, coverage: { complete: false, daysRead: [], rowCount: 0, uncertain: [] } };
function fallbackFixture(change = () => { }) {
    const calls = [];
    const env = { AI_ASSISTANT_ENABLED: 'true', AI: { run: async (_model, request) => {
                calls.push(request);
                const prompt = String(request.messages.at(-1)?.content && JSON.stringify(request.messages.at(-1)?.content));
                if (prompt.includes('FIRST READ ONLY'))
                    return { response: JSON.stringify(layout) };
                const day = prompt.includes('Monday') ? 1 : 2;
                const part = { row: { dayOfWeek: day, level: '100', cells: [{ from: 0, to: 1, label: '' }, { from: 1, to: 2, label: day === 1 ? 'MTH101' : 'PHY101' }] }, coverage: { complete: true, daysRead: [day], rowCount: 1, uncertain: [] } };
                change(part, day);
                return { response: JSON.stringify(part) };
            } } };
    // WebP is a supported upload even though the optional pixel decoder cannot
    // decode it. The binding stands in for the external provider, not the parser.
    const input = { mode: 'timetable', prompt: 'Read my full 100-level timetable', media: { mimeType: 'image/webp', data: btoa('private-webp-fixture') }, deadline: Date.now() + 150000 };
    return { env, input, calls };
}
describe('complete source-image import recovery', () => {
    it('decodes the private WebP original without losing grid geometry or exposing a URL',async()=>{
        const bytes=readFileSync(new URL('../../../scripts/fixtures/uniben-engineering-2026.webp',import.meta.url));
        expect(webpDimensions(bytes)).toEqual({width:691,height:471});
        const original={mimeType:'image/webp',data:bytes.toString('base64')};
        const prepared=await prepareTimetableImage(original);
        expect(original.mimeType).toBe('image/webp');expect(prepared.mimeType).toBe('image/png');
        expect(timetableLayoutImage(prepared)).toMatchObject({timeColumnCount:10,levelRowCount:25});
        expect(timetableImageRows(prepared,10,['100','200','300','400','500'],[1,2,3,4,5],'100')).toHaveLength(5);
    });
    it('reads every selected weekday when pixel border isolation is unavailable', async () => {
        const f = fallbackFixture(), result = await generateAcademicImport(f.env, f.input, '', 'class', { level: '100' });
        expect(result.extracted.entries).toMatchObject([{ courseCode: 'MTH101', dayOfWeek: 1, startsAt: '09:00', endsAt: '10:00' }, { courseCode: 'PHY101', dayOfWeek: 2, startsAt: '09:00', endsAt: '10:00' }]);
        expect(f.calls).toHaveLength(3);
        for (const request of f.calls)
            expect(JSON.stringify(request.messages)).toContain('data:image/webp;base64,');
        expect(f.calls[0]?.max_tokens).toBe(2048);
        expect(f.calls.slice(1).every(call=>call.max_tokens===2048)).toBe(true);
    });
    it('filters requested courses only after reading the whole selected level', async () => {
        const f = fallbackFixture(), result = await generateAcademicImport(f.env, f.input, '', 'class', { level: '100', courseCodes: ['PHY 101'] });
        expect(f.calls).toHaveLength(3);
        expect(result.extracted.entries).toHaveLength(1);
        expect(result.extracted.entries[0]).toMatchObject({ courseCode: 'PHY101', dayOfWeek: 2 });
    });
    it('maps all weekday rows to the shared verified headings without comparing independent JSON clocks', async () => {
        const f=fallbackFixture(part=>{part.row.level='100 Level';}),result=await generateAcademicImport(f.env,f.input,'','class',{level:'100'});
        expect(result.extracted.entries.every(row=>row.startsAt==='09:00'&&row.endsAt==='10:00')).toBe(true);
        for(const call of f.calls.slice(1)) {
            expect(JSON.stringify(call.messages)).toContain('Do not read or return time headings again');
            expect(JSON.stringify(call.messages)).toContain('08:00');
        }
    });
    it.each(['partial', 'wrong-level', 'wrong-day', 'missing-column', 'overlap'])('rejects %s without returning a half timetable', async (fault) => {
        const f = fallbackFixture((part, day) => {
            if (day !== 2)
                return;
            const row = part.row;
            if (fault === 'partial')
                part.coverage = { complete: false, daysRead: [2], rowCount: 1, uncertain: ['Tuesday'] };
            if (fault === 'wrong-level')
                row.level = '200';
            if (fault === 'wrong-day')
                row.dayOfWeek = 3;
            if (fault === 'missing-column') row.cells.pop();
            if (fault === 'overlap') row.cells[1].from=0;
        });
        await expect(generateAcademicImport(f.env, f.input, '', 'class', { level: '100' })).rejects.toMatchObject({ reason: 'AI_INCOMPLETE_SCHEDULE' });
    });
    it('rejects overlapping shared headings before asking the provider for any weekday cells',async()=>{
        const f=fallbackFixture();
        f.env.AI.run=async(_model,request)=>{f.calls.push(request);return{response:JSON.stringify({...layout,grid:{...layout.grid,timeSlots:[slots[0],slots[0]]}})};};
        await expect(generateAcademicImport(f.env,f.input,'','class',{level:'100'})).rejects.toMatchObject({reason:'AI_INCOMPLETE_SCHEDULE'});
        expect(f.calls).toHaveLength(1);
    });
    it('keeps 100-level cell positions and merged durations on the real faculty image', async () => {
        const labels = { 1: ['100', 'PHY101', 'CHM101', '', '', 'GST111', '', 'MTH101', ''], 2: ['100', 'STA112', 'MTH102', 'PHY104', 'MTH102', 'CHM101', '', '', '', ''], 3: ['100', '', 'MTH101', '', 'PHY101', 'GST112', '', '', ''], 4: ['100', 'GET101/ENS211', '', 'PHY103', 'MTH102', '', '', '', '', ''], 5: ['100', 'MTH101', 'PHY104', 'STA112', 'PHY103', '', '', '', '', '', ''] };
        const env = { AI_ASSISTANT_ENABLED: 'true', AI: { run: async (_model, request) => {
                    const prompt = JSON.stringify(request.messages);
                    if (prompt.includes('FIRST READ ONLY'))
                        return { response: JSON.stringify({ ...layout, grid: { ...layout.grid, timeSlots: Array.from({ length: 10 }, (_, i) => ({ startsAt: String(i + 8).padStart(2, '0') + ':00', endsAt: String(i + 9).padStart(2, '0') + ':00' })), levels: ['100', '200', '300', '400', '500'], daysSeen: [1, 2, 3, 4, 5] } }) };
                    const day = days.findIndex(name => prompt.includes('for ' + name + '.'));
                    return { response: JSON.stringify({ labels: Object.fromEntries(labels[day].map((label,panel)=>[String(panel),label])), coverage: { complete: true, uncertain: [] } }) };
                } } };
        const media = { mimeType: 'image/jpeg', data: readFileSync(new URL('../../../scripts/fixtures/uniben-engineering-2026.jpg', import.meta.url)).toString('base64') };
        const result = await generateAcademicImport(env, { mode: 'timetable', prompt: '100 level', media, deadline: Date.now() + 150000 }, '', 'class', { level: '100' });
        expect(result.extracted.entries).toHaveLength(19);
        expect(result.extracted.entries).toEqual(expect.arrayContaining([expect.objectContaining({ dayOfWeek: 1, courseCode: 'GST111', startsAt: '12:00', endsAt: '14:00' }), expect.objectContaining({ dayOfWeek: 2, courseCode: 'STA112', startsAt: '08:00', endsAt: '10:00' }), expect.objectContaining({ dayOfWeek: 4, courseCode: 'GET101/ENS211', startsAt: '08:00', endsAt: '10:00' })]));
        expect(result.extracted.entries.some(entry => String(entry.courseCode).includes('211') && entry.courseCode !== 'GET101/ENS211')).toBe(false);
    });
});
