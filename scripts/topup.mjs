/* Top-up: fill remaining slots with curated candidates that are NOT already in the deck.
   Writes ./topup.json (repo root, gitignored) — review and copy the rows you want
   into the matching data/*.json file; never leave output inside data/ (the build
   ingests every data/*.json). */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const TARGETS = { b1: 800, b2: 600, c1: 400, c2: 200 };

/* gather used words */
const used = new Set();
for (const f of readdirSync('data').filter((f) => f.endsWith('.json')).sort()) {
  for (const row of JSON.parse(readFileSync('data/' + f, 'utf8'))) used.add(String(row[0]).toLowerCase());
}

const CAND = {
  b1: [
    ['la persiana', 'window blind'], ['el enchufe', 'wall socket'], ['el interruptor', 'light switch'],
    ['el cajón', 'drawer'], ['el colchón', 'mattress'], ['el edredón', 'duvet'], ['la almohada', 'pillow'],
    ['la sábana', 'bed sheet'], ['el cojín', 'cushion'], ['la bañera', 'bathtub'], ['el lavabo', 'bathroom sink'],
    ['la cerradura', 'door lock'], ['la escalera', 'stairs'], ['el tejado', 'roof'], ['el sótano', 'basement'],
    ['el garaje', 'garage'], ['el pasillo', 'hallway'], ['el trastero', 'storage room'], ['la despensa', 'pantry'],
    ['el congelador', 'freezer'], ['el microondas', 'microwave'], ['el fregadero', 'kitchen sink'],
    ['la encimera', 'countertop'], ['el taburete', 'stool'], ['la mesilla', 'bedside table'],
    ['el perchero', 'coat rack'], ['la escoba', 'broom'], ['la fregona', 'mop'], ['el cubo', 'bucket'],
    ['el detergente', 'detergent'], ['la plancha', 'iron'], ['la secadora', 'tumble dryer'],
    ['el cepillo de dientes', 'toothbrush'], ['el casco', 'helmet'], ['las chanclas', 'flip-flops'],
    ['el impermeable', 'raincoat'], ['los calcetines', 'socks'], ['las manoplas', 'mittens'],
    ['el maniquí', 'mannequin'], ['el escaparate', 'shop window'], ['el probador', 'fitting room'],
    ['la cesta', 'basket'], ['el mostrador', 'counter'], ['la rebaja', 'price reduction'],
    ['el código de barras', 'barcode'], ['el ticket', 'receipt'], ['el regalo', 'gift'], ['envolver', 'to wrap'],
    ['el zapatero', 'shoe rack'], ['el calendario', 'calendar'], ['la alarma', 'alarm'], ['el despertador', 'alarm clock'],
    ['el abanico', 'hand fan'], ['la vela', 'candle'], ['el mechero', 'lighter'], ['la cerilla', 'match'],
    ['el pomo', 'door handle'], ['la visera', 'visor'], ['el toldo', 'awning'], ['la barandilla', 'railing'],
    ['el buzón', 'mailbox'], ['el sello', 'postage stamp'], ['la estampilla', 'stamp'], ['el sobre', 'envelope'],
    ['la grapadora', 'stapler'], ['el clip', 'paper clip'], ['la goma', 'eraser'], ['el subrayador', 'highlighter'],
    ['la libreta', 'notebook'], ['el bolígrafo', 'pen'], ['el lápiz', 'pencil'], ['la mochila escolar', 'school backpack'],
    ['la regla', 'ruler'], ['las tijeras', 'scissors'], ['el pegamento', 'glue'], ['la cinta adhesiva', 'adhesive tape'],
    ['el corcho', 'cork'], ['el sacacorchos', 'corkscrew'], ['el abrelatas', 'can opener'], ['el colador', 'strainer'],
    ['el escurridor', 'colander'], ['la bandeja', 'tray'], ['el cuenco', 'bowl'], ['el platito', 'saucer'],
    ['la jarra', 'pitcher'], ['la tetera', 'teapot'], ['la cafetera', 'coffee maker'], ['la tostadora', 'toaster'],
    ['la batidora', 'blender'], ['la picadora', 'food processor'], ['la olla a presión', 'pressure cooker'],
    ['la cacerola', 'saucepan'], ['el cucharón', 'ladle'], ['la espumadera', 'skimmer'], ['el rallador', 'grater'],
  ],
  b2: [
    ['la documentación', 'paperwork'], ['el expediente', 'file, record'], ['el trámite', 'procedure'],
    ['la gestión', 'management'], ['el formulario', 'form'], ['la solicitud', 'application'],
    ['la convocatoria', 'call for applications'], ['la entidad', 'entity'], ['la institución', 'institution'],
    ['la administración', 'administration'], ['el funcionario', 'public servant'], ['el medicamento', 'medication'],
    ['la dosis', 'dose'], ['la alergia', 'allergy'], ['el colesterol', 'cholesterol'], ['la tensión arterial', 'blood pressure'],
    ['el soporte técnico', 'tech support'], ['el mantenimiento', 'maintenance'], ['actualizar', 'to update'],
    ['desinstalar', 'to uninstall'], ['la publicidad', 'advertising'], ['el anuncio', 'advertisement'],
    ['el consumidor', 'consumer'], ['la demanda', 'demand'], ['la oferta', 'offer, supply'], ['la moda', 'fashion'],
    ['el diseño', 'design'], ['el fabricante', 'manufacturer'], ['la distribución', 'distribution'],
    ['el almacén', 'warehouse'], ['la infraestructura', 'infrastructure'], ['la urbanización', 'housing development'],
    ['el consultorio', 'doctor\'s office'], ['la ambulancia', 'ambulance'], ['el quirófano', 'operating room'],
    ['la vacuna de refuerzo', 'booster shot'], ['el análisis de sangre', 'blood test'], ['la audición', 'hearing'],
    ['la tomografía', 'CT scan'], ['la resonancia', 'MRI scan'], ['el yeso', 'cast'], ['las muletas', 'crutches'],
    ['la silla de ruedas', 'wheelchair'], ['el vendaje', 'bandage'], ['la gasa', 'gauze'], ['el algodón', 'cotton ball'],
    ['el termómetro', 'thermometer'], ['la báscula', 'bathroom scale'], ['el gotero', 'eyedropper'],
    ['la retina', 'retina'], ['el párpado', 'eyelid'], ['el tobillo', 'ankle'], ['la muñeca', 'wrist'],
    ['la cadera', 'hip'], ['el codo', 'elbow'], ['la vértebra', 'vertebra'], ['el intestino', 'intestine'],
    ['la vejiga', 'bladder'], ['el útero', 'uterus'], ['la tiroides', 'thyroid'], ['el páncreas', 'pancreas'],
    ['el esófago', 'esophagus'], ['el tendón', 'tendon'], ['el ligamento', 'ligament'],
    ['la gestión de proyectos', 'project management'], ['el organigrama', 'organizational chart'],
    ['la jornada laboral', 'working day'], ['el teletrabajo', 'remote work'], ['la conciliación', 'work-life balance'],
    ['el ERTE', 'temporary layoff scheme'], ['el despido colectivo', 'mass layoff'], ['el sindicato', 'labor union'],
    ['la negociación', 'negotiation'], ['el convenio', 'collective agreement'], ['la huelga de celo', 'work-to-rule'],
    ['el salario mínimo', 'minimum wage'], ['la nómina', 'payroll'], ['la cotización', 'social security contribution'],
    ['la pensión de jubilación', 'retirement pension'], ['el fondo de inversión', 'investment fund'],
    ['la rentabilidad', 'profitability'], ['el margen de beneficio', 'profit margin'], ['el punto de equilibrio', 'break-even point'],
  ],
  c1: [
    ['la idiosincrasia', 'idiosyncrasy'], ['la introspección', 'introspection'], ['el atisbo', 'glimmer, hint'],
    ['el escollo', 'obstacle, stumbling block'], ['la traba', 'hindrance'], ['los entresijos', 'ins and outs'],
    ['la maraña', 'tangle'], ['el cauce', 'riverbed; course'], ['la tesitura', 'predicament'], ['la diatriba', 'diatribe'],
    ['la arenga', 'harangue'], ['la invectiva', 'invective'], ['la alabanza', 'praise'], ['el elogio', 'eulogy, praise'],
    ['la censura', 'censorship'], ['la mordaza', 'gag'], ['el despropósito', 'nonsense, absurdity'],
    ['el desatino', 'folly'], ['el dislate', 'absurdity'], ['la sandez', 'piece of nonsense'],
    ['el galimatías', 'gobbledygook'], ['la sinrazón', 'irrationality'], ['la afrenta', 'affront'],
    ['la infamia', 'infamy'], ['el resquicio', 'gap, loophole'], ['la fisura', 'fissure'],
    ['el asedio', 'siege'], ['la ofensiva', 'offensive'], ['la contraofensiva', 'counteroffensive'],
    ['el armisticio', 'armistice'], ['la tregua', 'truce'], ['la mediación', 'mediation'], ['el arbitraje', 'arbitration'],
    ['la conciliación judicial', 'court-ordered mediation'], ['el litigio', 'lawsuit, litigation'],
    ['el procedimiento', 'legal procedure'], ['la jurisprudencia', 'case law'], ['la doctrina', 'doctrine'],
    ['el alegato', 'legal argument'], ['la sentencia', 'court ruling'], ['la absolución', 'acquittal'],
    ['la condena', 'sentence, conviction'], ['la fianza', 'bail'], ['el recurso de apelación', 'appeal'],
    ['el testigo', 'witness'], ['el perito', 'expert witness'],
    ['la coartada', 'alibi'], ['el interrogatorio', 'questioning, interrogation'], ['el careo', 'face-to-face confrontation'],
    ['la diligencia', 'judicial proceeding'], ['la querella', 'criminal complaint'], ['el inculpado', 'defendant'],
  ],
  c2: [
    ['la lumbre', 'firelight'], ['el rescoldo', 'embers'], ['el zaguán', 'entrance hall'], ['la techumbre', 'roof structure'],
    ['el alféizar', 'windowsill'], ['la madeja', 'skein of yarn'], ['el jirón', 'tatter, shred'],
    ['la tribulación', 'tribulation'], ['el marasmo', 'stagnation, torpor'], ['el desvarío', 'delirium, ravings'],
    ['el duermevela', 'half-sleep'], ['el sobrecogimiento', 'awe, dread'], ['la congoja', 'anguish, grief'],
    ['el duelo', 'grief, mourning'], ['la sacristía', 'sacristy'], ['el púlpito', 'pulpit'], ['el rosetón', 'rose window'],
    ['la vidriera', 'stained-glass window'], ['el artesonado', 'coffered ceiling'], ['el entramado', 'framework'],
    ['la angostura', 'narrowness'], ['la estrechez', 'tightness, narrowness'], ['el pairo', 'hove-to position'],
    ['la bonanza', 'fair weather; prosperity'], ['el oleaje', 'swell, waves'], ['la marejada', 'heavy sea'],
    ['la resaca', 'undertow'], ['el bajío', 'shoal, sandbar'], ['el arrecife', 'reef'], ['el acantilado', 'cliff'],
    ['la ensenada', 'cove'], ['el estero', 'marshland estuary'], ['la ciénaga', 'bog, marsh'], ['el tremedal', 'quagmire'],
    ['la linde', 'boundary between fields'], ['el majadal', 'enclosed pasture'], ['la dehesa', 'fenced grazing land'],
    ['el encinar', 'holm-oak grove'], ['el robledal', 'oak grove'], ['la chopera', 'poplar grove'],
    ['el soto', 'riverside grove'], ['la arboleda', 'grove of trees'], ['el follaje', 'foliage'], ['la fronda', 'leafage'],
    ['el boscaje', 'thicket'], ['la espesura', 'dense undergrowth'], ['la maleza', 'weeds, underbrush'],
    ['la zarza', 'bramble, blackberry bush'], ['el espino', 'hawthorn'], ['la retama', 'broom shrub'],
    ['el tomillar', 'thyme patch'], ['el brezal', 'heathland'], ['la landa', 'heath'],
  ],
};

const out = {};
let added = 0;
/* compute shortfall per level — dedupe-aware (same rule as build.mjs: first file wins) */
const counts = { b1: 0, b2: 0, c1: 0, c2: 0 };
const seenCount = new Set();
for (const f of readdirSync('data').filter((f) => f.endsWith('.json')).sort()) {
  for (const row of JSON.parse(readFileSync('data/' + f, 'utf8'))) {
    const key = String(row[0]).toLowerCase();
    if (seenCount.has(key)) continue;
    seenCount.add(key);
    counts[row[2]]++;
  }
}
for (const lvl of Object.keys(TARGETS)) {
  const need = TARGETS[lvl] - counts[lvl];
  const picked = [];
  for (const [es, en] of CAND[lvl]) {
    if (picked.length >= need) break;
    if (!used.has(String(es).toLowerCase())) {
      picked.push([es, en, lvl]);
      used.add(String(es).toLowerCase());
    }
  }
  if (picked.length < need) { console.error('only ' + picked.length + '/' + need + ' candidates for ' + lvl + ' — extend CAND list'); process.exit(1); }
  out[lvl] = picked;
  added += picked.length;
  console.log(lvl + ': adding ' + picked.length + ' -> ' + (counts[lvl] + picked.length) + '/' + TARGETS[lvl]);
}

const all = [...out.b1, ...out.b2, ...out.c1, ...out.c2];
writeFileSync('topup.json', JSON.stringify(all, null, 1) + '\n');
console.log('written topup.json with', all.length, 'entries — review, then copy into data/*.json');