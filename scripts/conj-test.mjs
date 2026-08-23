/* Conjugation engine battery: exact forms for every irregular verb + spot checks.
   Run: node scripts/conj-test.mjs */
import Conj from '../src/conj.cjs';
import { readFileSync, readdirSync } from 'node:fs';

let fails = 0, total = 0;
function ok(cond, name) {
  total++;
  if (!cond) { fails++; console.error('FAIL:', name); }
}

/* form(phrase, tense, person) → cell string (pronouns discarded) */
function cell(t, tense, person) {
  const tm = t.tenses.find((x) => x.label === tense);
  const row = tm && tm.rows.find((r) => r[0] === person);
  return row ? row[1] : null;
}
function anyCell(t, tense, needle) {
  const tm = t.tenses.find((x) => x.label === tense);
  return tm && tm.rows.some((r) => r[1] === needle);
}

/* ---------- irregulars ---------- */
function checkIrreg(head, checks) {
  const t = Conj.table(head);
  ok(!!t, head + ' conjugatable');
  if (!t) return;
  for (const [tense, form] of checks) {
    ok(anyCell(t, tense, form), head + ' ' + tense + ' has ' + form);
  }
}

checkIrreg('dar', [
  ['Present', 'doy'], ['Present', 'dais'], ['Preterite', 'dio'], ['Preterite', 'dieron'],
  ['Imperfect', 'dábamos'], ['Future', 'daré'], ['Future', 'darán'],
  ['Conditional', 'daría'], ['Present subj.', 'dé'], ['Present subj.', 'deis'],
  ['Imperfect subj.', 'diéramos']
]);
checkIrreg('ir', [
  ['Present', 'voy'], ['Present', 'vamos'], ['Preterite', 'fue'], ['Preterite', 'fueron'],
  ['Imperfect', 'iba'], ['Future', 'iré'], ['Conditional', 'iría'],
  ['Present subj.', 'vaya'], ['Present subj.', 'vayáis'], ['Imperfect subj.', 'fuera']
]);
checkIrreg('ser', [
  ['Present', 'soy'], ['Present', 'es'], ['Preterite', 'fui'], ['Imperfect', 'éramos'],
  ['Future', 'será'], ['Conditional', 'seríamos'], ['Present subj.', 'sea'], ['Present subj.', 'seáis'],
  ['Imperfect subj.', 'fueran']
]);
checkIrreg('estar', [
  ['Present', 'estoy'], ['Present', 'estáis'], ['Preterite', 'estuvo'], ['Preterite', 'estuvieron'],
  ['Imperfect', 'estábamos'], ['Future', 'estaré'], ['Present subj.', 'esté'],
  ['Imperfect subj.', 'estuviéramos']
]);
checkIrreg('tener', [
  ['Present', 'tengo'], ['Present', 'tenéis'], ['Preterite', 'tuve'], ['Preterite', 'tuvieron'],
  ['Future', 'tendré'], ['Future', 'tendrán'], ['Conditional', 'tendría'],
  ['Present subj.', 'tengamos'], ['Imperfect subj.', 'tuviéramos']
]);
checkIrreg('mantener', [
  ['Present', 'mantengo'], ['Present', 'mantienen'], ['Preterite', 'mantuvo'],
  ['Future', 'mantendré'], ['Future', 'mantendrán'], ['Present subj.', 'mantengan'],
  ['Imperfect subj.', 'mantuviéramos']
]);
checkIrreg('sostener', [
  ['Present', 'sostengo'], ['Preterite', 'sostuvimos'], ['Future', 'sostendré'],
  ['Present subj.', 'sostengamos']
]);
checkIrreg('venir', [
  ['Present', 'vengo'], ['Present', 'venís'], ['Preterite', 'vino'], ['Preterite', 'vinieron'],
  ['Future', 'vendré'], ['Conditional', 'vendría'], ['Present subj.', 'vengas'],
  ['Imperfect subj.', 'viniéramos']
]);
checkIrreg('prevenir', [
  ['Present', 'prevengo'], ['Preterite', 'previno'], ['Future', 'prevendré'],
  ['Present subj.', 'prevengan']
]);
checkIrreg('sobrevenir', [
  ['Present', 'sobrevengo'], ['Preterite', 'sobrevino'], ['Future', 'sobrevendrá'],
  ['Present subj.', 'sobrevenga']
]);
checkIrreg('poner', [
  ['Present', 'pongo'], ['Preterite', 'puso'], ['Preterite', 'pusieron'], ['Future', 'pondré'],
  ['Conditional', 'pondrían'], ['Present subj.', 'pongamos'], ['Imperfect subj.', 'pusiera']
]);
checkIrreg('presuponer', [
  ['Present', 'presupongo'], ['Preterite', 'presupuso'], ['Future', 'presupondremos'],
  ['Present subj.', 'presupongáis']
]);
checkIrreg('decir', [
  ['Present', 'digo'], ['Present', 'decís'], ['Preterite', 'dijo'], ['Preterite', 'dijeron'],
  ['Future', 'diré'], ['Future', 'dirán'], ['Conditional', 'diría'],
  ['Present subj.', 'digamos'], ['Imperfect subj.', 'dijéramos']
]);
checkIrreg('contradecir', [
  ['Present', 'contradigo'], ['Present', 'contradice'], ['Preterite', 'contradijo'],
  ['Preterite', 'contradijeron'], ['Future', 'contradiré'], ['Present subj.', 'contradiga'],
  ['Imperfect subj.', 'contradijera']
]);
checkIrreg('hacer', [
  ['Present', 'hago'], ['Present', 'hacéis'], ['Preterite', 'hice'], ['Preterite', 'hizo'],
  ['Preterite', 'hicieron'], ['Future', 'haré'], ['Future', 'harán'], ['Conditional', 'haría'],
  ['Present subj.', 'hagamos'], ['Imperfect subj.', 'hiciera']
]);
checkIrreg('andar', [
  ['Present', 'ando'], ['Preterite', 'anduvimos'], ['Preterite', 'anduvieron'],
  ['Future', 'andaré'], ['Present subj.', 'andemos'], ['Imperfect subj.', 'anduviera']
]);
checkIrreg('desmentir', [
  ['Present', 'desmiento'], ['Preterite', 'desmintió'], ['Preterite', 'desmintieron'],
  ['Present subj.', 'desmintamos'], ['Future', 'desmentiré'], ['Imperfect subj.', 'desmintiera']
]);
checkIrreg('disentir', [
  ['Present', 'disiento'], ['Present', 'disienten'], ['Preterite', 'disintió'],
  ['Present subj.', 'disintáis'], ['Future', 'disentiré'], ['Imperfect subj.', 'disintiera']
]);
checkIrreg('reducir', [
  ['Present', 'reduzco'], ['Preterite', 'reduje'], ['Preterite', 'redujeron'],
  ['Future', 'reduciré'], ['Present subj.', 'reduzcamos'], ['Imperfect subj.', 'redujera']
]);
checkIrreg('deducir', [
  ['Present', 'deduzco'], ['Preterite', 'dedujo'], ['Present subj.', 'deduzcamos'],
  ['Imperfect subj.', 'dedujeran']
]);
checkIrreg('reír', [
  ['Present', 'río'], ['Present', 'ríes'], ['Present', 'reímos'], ['Present', 'reís'],
  ['Preterite', 'rió'], ['Preterite', 'rieron'], ['Future', 'reiré'],
  ['Present subj.', 'ría'], ['Present subj.', 'riamos'], ['Present subj.', 'riáis'],
  ['Imperfect subj.', 'riéramos']
]);
checkIrreg('sonreír', [
  ['Present', 'sonrío'], ['Present', 'sonríen'], ['Present', 'sonreímos'], ['Preterite', 'sonrió'],
  ['Present subj.', 'sonría'], ['Future', 'sonreiré']
]);

/* ---------- stem changers ---------- */
checkIrreg('pensar', [
  ['Present', 'pienso'], ['Present', 'pensamos'], ['Present subj.', 'pienses'],
  ['Present subj.', 'pensemos'], ['Preterite', 'pensé'], ['Imperfect subj.', 'pensara'],
  ['Future', 'pensaré']
]);
checkIrreg('entender', [
  ['Present', 'entiendo'], ['Present', 'entendéis'], ['Present subj.', 'entienda'],
  ['Present subj.', 'entendamos'], ['Preterite', 'entendió'], ['Imperfect subj.', 'entendiera']
]);
checkIrreg('perderse', [
  ['Present', 'me pierdo'], ['Present', 'se pierden'], ['Present subj.', 'me pierda'],
  ['Preterite', 'se perdió'], ['Imperfect subj.', 'me perdiera']
]);
checkIrreg('despertarse', [
  ['Present', 'me despierto'], ['Present', 'nos despertamos'], ['Present subj.', 'me despierte'],
  ['Preterite', 'se despertó'], ['Imperfect subj.', 'me despertara']
]);
checkIrreg('quebrar', [
  ['Present', 'quiebro'], ['Present subj.', 'quiebren'], ['Preterite', 'quebré']
]);
checkIrreg('inferir', [
  ['Present', 'infiero'], ['Preterite', 'infirió'], ['Present subj.', 'infiramos'],
  ['Imperfect subj.', 'infiriera']
]);
checkIrreg('discernir', [
  ['Present', 'discierno'], ['Present', 'discernimos'], ['Preterite', 'discernió'],
  ['Present subj.', 'disciernan'], ['Present subj.', 'discernamos']
]);
checkIrreg('soñar', [
  ['Present', 'sueño'], ['Present', 'soñamos'], ['Present subj.', 'sueñes'],
  ['Preterite', 'soñé'], ['Future', 'soñaré']
]);
checkIrreg('aprobar', [
  ['Present', 'apruebo'], ['Present subj.', 'apruebe'], ['Preterite', 'aprobé']
]);
checkIrreg('probar', [['Present', 'pruebo'], ['Present subj.', 'pruebes']]);
checkIrreg('recordar', [['Present', 'recuerdo'], ['Present subj.', 'recuerden']]);
checkIrreg('costar', [['Present', 'cuesto'], ['Present', 'cuesta'], ['Present subj.', 'cueste']]);
checkIrreg('devolver', [
  ['Present', 'devuelvo'], ['Present subj.', 'devuelvas'], ['Preterite', 'devolví'],
  ['Imperfect subj.', 'devolviera']
]);
const tdev = Conj.table('devolver');
ok(tdev && tdev.participle === 'devuelto', 'devolver participle devuelto');
checkIrreg('resolver', [
  ['Present', 'resuelvo'], ['Present subj.', 'resuelva'], ['Preterite', 'resolví'],
  ['Imperfect subj.', 'resolviera']
]);
const tres = Conj.table('resolver');
ok(tres && tres.participle === 'resuelto', 'resolver participle resuelto');
checkIrreg('soler', [
  ['Present', 'suelo'], ['Present', 'solemos'], ['Present subj.', 'suela'],
  ['Preterite', 'solí'], ['Future', 'soleré'], ['Imperfect subj.', 'soliera']
]);
checkIrreg('dormirse', [
  ['Present', 'me duermo'], ['Present', 'nos dormimos'], ['Preterite', 'se durmió'],
  ['Present subj.', 'me duerma'], ['Present subj.', 'nos durmamos'],
  ['Imperfect subj.', 'se durmiera']
]);
checkIrreg('jugar', [
  ['Present', 'juego'], ['Present', 'jugamos'], ['Preterite', 'jugué'],
  ['Preterite', 'jugó'], ['Present subj.', 'juegues'], ['Present subj.', 'juguemos'],
  ['Future', 'jugaré']
]);
checkIrreg('renegar', [
  ['Present', 'reniego'], ['Preterite', 'renegué'], ['Present subj.', 'reniegue'],
  ['Present subj.', 'reneguemos']
]);
checkIrreg('vestirse', [
  ['Present', 'me visto'], ['Present', 'nos vestimos'], ['Preterite', 'se vistió'],
  ['Present subj.', 'me vista'], ['Present subj.', 'nos vistamos'],
  ['Imperfect subj.', 'me vistiera']
]);
checkIrreg('despedir', [
  ['Present', 'despido'], ['Preterite', 'despidió'], ['Present subj.', 'despidamos'],
  ['Imperfect subj.', 'despidiera'], ['Future', 'despediré']
]);
checkIrreg('seguir', [
  ['Present', 'sigo'], ['Present', 'seguimos'], ['Present', 'siguen'], ['Preterite', 'siguió'],
  ['Present subj.', 'siga'], ['Present subj.', 'sigamos'], ['Preterite', 'seguí'], ['Imperfect subj.', 'siguiera'], ['Future', 'seguiré']
]);
checkIrreg('conseguir', [
  ['Present', 'consigo'], ['Present', 'conseguimos'], ['Preterite', 'consiguió'],
  ['Present subj.', 'consigamos']
]);
checkIrreg('elegir', [
  ['Present', 'elijo'], ['Present', 'elegimos'], ['Preterite', 'eligió'], ['Preterite', 'eligieron'],
  ['Present subj.', 'elijamos'], ['Present subj.', 'elijáis'],
  ['Imperfect subj.', 'eligiera'], ['Future', 'elegiré']
]);
checkIrreg('parecer', [
  ['Present', 'parezco'], ['Present subj.', 'parezca'], ['Present subj.', 'parezcamos'],
  ['Preterite', 'parecí'], ['Future', 'pareceré']
]);
checkIrreg('merecer', [['Present', 'merezco'], ['Present subj.', 'merezcan']]);
checkIrreg('apetecer', [['Present', 'apetezco'], ['Present subj.', 'apetezca']]);
checkIrreg('prohibir', [
  ['Present', 'prohíbo'], ['Present', 'prohíbes'], ['Present', 'prohibimos'],
  ['Present', 'prohíben'], ['Present subj.', 'prohíba'], ['Preterite', 'prohibí'],
  ['Preterite', 'prohibió'], ['Future', 'prohibiré']
]);
checkIrreg('leer', [
  ['Present', 'leo'], ['Present', 'leemos'], ['Preterite', 'leí'], ['Preterite', 'leyó'],
  ['Preterite', 'leyeron'],
  ['Imperfect subj.', 'leyera'], ['Future', 'leeré'], ['Present subj.', 'leamos']
]);
checkIrreg('creer', [
  ['Present', 'creo'], ['Preterite', 'creí'], ['Preterite', 'creyó'], ['Preterite', 'creyeron'], ['Imperfect subj.', 'creyera'], ['Future', 'creeré']
]);
checkIrreg('escribir', [
  ['Present', 'escribo'], ['Preterite', 'escribí'],
  ['Future', 'escribiré']
]);
const tesc = Conj.table('escribir');
ok(tesc && tesc.participle === 'escrito', 'escribir participle escrito');

/* ---------- regulars & orthography ---------- */
checkIrreg('pagar', [
  ['Present', 'pago'], ['Preterite', 'pagué'], ['Preterite', 'pagó'],
  ['Present subj.', 'pague'], ['Present subj.', 'paguemos'], ['Future', 'pagaré']
]);
checkIrreg('publicar', [
  ['Present', 'publico'], ['Preterite', 'publiqué'], ['Preterite', 'publicó'],
  ['Present subj.', 'publique'], ['Present subj.', 'publiquemos']
]);
checkIrreg('actualizar', [
  ['Present', 'actualizo'], ['Preterite', 'actualicé'], ['Present subj.', 'actualice'],
  ['Present subj.', 'actualicemos']
]);
checkIrreg('madrugar', [['Preterite', 'madrugué'], ['Present subj.', 'madrugue']]);
checkIrreg('lograr', [['Preterite', 'logré'], ['Present subj.', 'logre']]);
checkIrreg('equivocarse', [
  ['Present', 'me equivoco'], ['Preterite', 'me equivoqué'], ['Preterite', 'se equivocó'],
  ['Present subj.', 'me equivoque'], ['Present subj.', 'nos equivoquemos'], ['Future', 'me equivocaré']
]);
checkIrreg('percatarse', [
  ['Present', 'me percato'], ['Preterite', 'me percaté'], ['Present subj.', 'me percate'],
  ['Future', 'me percataré']
]);
checkIrreg('bailar', [
  ['Present', 'bailo'], ['Preterite', 'bailé'], ['Present subj.', 'bailen'], ['Future', 'bailaré']
]);
checkIrreg('vender', [
  ['Present', 'vendo'], ['Preterite', 'vendí'], ['Preterite', 'vendió'],
  ['Present subj.', 'vendan'], ['Future', 'venderé']
]);
/* ---------- imperatives (incl. reflexives w/ clitic orthography) ---------- */
function imp(head) { return Conj.table(head) ? Conj.table(head).imperative : null; }
function impOk(head, k, form) {
  const t = Conj.table(head);
  ok(t && t.imperative && t.imperative[k] === form, head + ' imperativo ' + k + ' = ' + form + ' (got ' + (t && t.imperative ? t.imperative[k] : '?') + ')');
}
impOk('pagar', 'tu', 'paga');
impOk('pagar', 'vosotros', 'pagad');
impOk('comer', 'tu', 'come');
impOk('vivir', 'tu', 'vive');
impOk('tener', 'tu', 'ten');
impOk('tener', 'vosotros', 'tened');
impOk('mantener', 'tu', 'mantén');
impOk('sostener', 'tu', 'sostén');
impOk('prevenir', 'tu', 'prevén');
impOk('sobrevenir', 'tu', 'sobrevén');
impOk('presuponer', 'tu', 'presupón');
impOk('oponerse', 'tu', 'oponte');
impOk('oponerse', 'vosotros', 'oponeos');
impOk('hacer', 'tu', 'haz');
impOk('contradecir', 'tu', 'contradice');
impOk('desmentir', 'tu', 'desmiente');
impOk('disentir', 'tu', 'disiente');
impOk('reducir', 'tu', 'reduce');
impOk('deducir', 'tu', 'deduce');
impOk('reír', 'tu', 'ríe');
impOk('reír', 'vosotros', 'reíd');
impOk('sonreír', 'tu', 'sonríe');
impOk('sonreír', 'vosotros', 'sonreíd');
impOk('prohibir', 'tu', 'prohíbe');
impOk('jugar', 'tu', 'juega');
impOk('jugar', 'vosotros', 'jugad');
impOk('seguir', 'tu', 'sigue');
impOk('elegir', 'tu', 'elige');
impOk('despertarse', 'tu', 'despiértate');
impOk('despertarse', 'vosotros', 'despertaos');
impOk('despertarse', 'nosotros', 'despertémonos');
impOk('levantarse', 'tu', 'levántate');
impOk('levantarse', 'vosotros', 'levantaos');
impOk('levantarse', 'nosotros', 'levantémonos');
impOk('ducharse', 'tu', 'dúchate');
impOk('ducharse', 'vosotros', 'duchaos');
impOk('afeitarse', 'tu', 'aféitate');
impOk('afeitarse', 'vosotros', 'afeitaos');
impOk('maquillarse', 'tu', 'maquíllate');
impOk('maquillarse', 'vosotros', 'maquillaos');
impOk('vestirse', 'tu', 'vístete');
impOk('vestirse', 'vosotros', 'vestíos');
impOk('vestirse', 'nosotros', 'vistámonos');
impOk('acostarse', 'tu', 'acuéstate');
impOk('acostarse', 'vosotros', 'acostaos');
impOk('dormirse', 'tu', 'duérmete');
impOk('dormirse', 'vosotros', 'dormíos');
impOk('dormirse', 'nosotros', 'durmámonos');
impOk('reírse', 'tu', 'ríete');
impOk('reírse', 'vosotros', 'reíos');
impOk('reírse', 'nosotros', 'riámonos');
impOk('sonreír', 'tu', 'sonríe');
impOk('probarse', 'tu', 'pruébate');
impOk('probarse', 'vosotros', 'probaos');
impOk('perderse', 'tu', 'piérdete');
impOk('perderse', 'vosotros', 'perdeos');
impOk('recuperarse', 'tu', 'recupérate');
impOk('recuperarse', 'vosotros', 'recuperaos');
impOk('relajarse', 'tu', 'relájate');
impOk('relajarse', 'vosotros', 'relajaos');
impOk('quedarse', 'tu', 'quédate');
impOk('quedarse', 'vosotros', 'quedaos');
impOk('irse', 'tu', 'vete');
impOk('irse', 'vosotros', 'idos');
impOk('irse', 'nosotros', 'vámonos');
impOk('darse', 'tu', 'date');
impOk('darse', 'vosotros', 'daos');
impOk('darse', 'nosotros', 'démonos');
impOk('hacerse', 'tu', 'hazte');
impOk('hacerse', 'vosotros', 'haceos');
impOk('ponerse', 'tu', 'ponte');
impOk('ponerse', 'vosotros', 'poneos');
impOk('ponerse', 'nosotros', 'pongámonos');
impOk('abstenerse', 'tu', 'abstente');
impOk('abstenerse', 'vosotros', 'absteneos');
impOk('acogerse', 'tu', 'acógete');
impOk('acogerse', 'vosotros', 'acogeos');
impOk('zambullirse', 'tu', 'zambúllete');
impOk('zambullirse', 'vosotros', 'zambullíos');
impOk('cerciorarse', 'tu', 'cerciórate');
impOk('cerciorarse', 'vosotros', 'cercioraos');
impOk('percatarse', 'tu', 'percátate');
impOk('equivocarse', 'tu', 'equivócate');
impOk('equivocarse', 'vosotros', 'equivocaos');
impOk('contradecir', 'usted', 'contradiga');
impOk('contradecir', 'ustedes', 'contradigan');

/* ---------- analyze / phrases / defectives / coverage ---------- */
const a1 = Conj.analyze('pagar');
ok(a1 && a1.head === 'pagar' && a1.suffix === '', 'analyze: bare infinitive');
const a2 = Conj.analyze('tomar el pelo');
ok(a2 && a2.head === 'tomar' && a2.suffix === ' el pelo', 'analyze: leading infinitive + suffix');
const a3 = Conj.analyze('darse cuenta');
ok(a3 && a3.head === 'darse' && a3.reflex && a3.suffix === ' cuenta', 'analyze: reflexive + suffix');
const a4 = Conj.analyze('no pegar ojo');
ok(a4 && a4.head === 'pegar' && a4.suffix === ' ojo', 'analyze: strips leading no');
const a5 = Conj.analyze('ayer');
ok(a5 === null, 'analyze: ayer excluded (not a verb)');
const a6 = Conj.analyze('el mar');
ok(a6 === null, 'analyze: noun phrase rejected');
const a7 = Conj.analyze('cabe destacar');
ok(a7 === null, 'analyze: non-infinitive head rejected');
const a8 = Conj.analyze('la casa');
ok(a8 === null, 'analyze: article-headed word rejected');

const td = Conj.table('atañer');
ok(td && td.defective, 'atañer marked defective');
if (td) {
  ok(td.tenses.length === 7, 'defective still lists tenses');
  ok(cell(td, 'Present', 'él/ella') === 'atañe' && cell(td, 'Present', 'ellos/ellas') === 'atañen', 'atañer 3rd persons');
  ok(td.imperative === null, 'defective has no imperative');
}
const tac = Conj.table('acaecer');
ok(tac && tac.defective && cell(tac, 'Present', 'él/ella') === 'acaece', 'acaecer defective');
const tata = Conj.table('atañer');
ok(tata && cell(tata, 'Preterite', 'él/ella') === 'atañó' && cell(tata, 'Preterite', 'ellos/ellas') === 'atañeron', 'atañer preterite i-drop');
ok(tata && cell(tata, 'Imperfect subj.', 'él/ella') === 'atañera' && tata.gerund === 'atañendo', 'atañer isub/gerund i-drop');
const tzam = Conj.table('zambullirse');
ok(tzam && cell(tzam, 'Preterite', 'él/ella') === 'se zambulló' && cell(tzam, 'Preterite', 'ellos/ellas') === 'se zambulleron', 'zambullirse preterite i-drop');
ok(tzam && tzam.gerund === 'zambullendo' && tzam.gerundSe === 'zambulléndose', 'zambullirse gerund i-drop');
const tin = Conj.table('incumbir');
ok(tin && tin.defective && cell(tin, 'Present', 'él/ella') === 'incumbe', 'incumbir defective');

/* full-deck coverage: every entry that starts with an infinitive must conjugate */
const files = readdirSync('data').filter((f) => f.endsWith('.json')).sort();
let missing = [];
for (const f of files) {
  const arr = JSON.parse(readFileSync('data/' + f, 'utf8'));
  for (const row of arr) {
    const a = Conj.analyze(row[0]);
    if (a && !Conj.table(a.head)) missing.push(row[0]);
  }
}
ok(missing.length === 0, 'deck coverage: every infinitive-led entry conjugates' + (missing.length ? ' — ' + missing.join(', ') : ''));

const t6 = Conj.table('soler');
ok(t6 && cell(t6, 'Present', 'yo') === 'suelo', 'soler present yo');
const t7 = Conj.table('pagar');
if (t7) {
  ok(t7.gerund === 'pagando' && t7.participle === 'pagado', 'pagar gerund/participle');
}
const t8 = Conj.table('irse');
if (t8) {
  ok(cell(t8, 'Present', 'yo') === 'me voy', 'irse present yo');
  ok(cell(t8, 'Preterite', 'yo') === 'me fui', 'irse preterite yo');
  ok(t8.gerundSe === 'yéndose', 'irse gerund se-form');
}
const tinf = Conj.table('inferir');
ok(tinf && tinf.gerund === 'infiriendo', 'inferir gerund');
const tdor = Conj.table('dormirse');
ok(tdor && tdor.gerund === 'durmiendo', 'dormirse gerund');
const tle = Conj.table('leer');
ok(tle && tle.gerund === 'leyendo' && tle.participle === 'leído', 'leer gerund/participle');
const t9 = Conj.table('levantarse');
if (t9) {
  ok(cell(t9, 'Present', 'nosotros') === 'nos levantamos', 'levantarse nosotros');
  ok(cell(t9, 'Preterite', 'ellos/ellas') === 'se levantaron', 'levantarse ellos');
  ok(t9.gerundSe === 'levantándose', 'levantarse gerund se-form');
}
const t10 = Conj.table('reírse');
if (t10) {
  ok(cell(t10, 'Present', 'yo') === 'me río', 'reírse yo');
  ok(t10.gerundSe === 'riéndose', 'reírse gerund se-form');
}
const t11 = Conj.table('vestirse');
if (t11) {
  ok(cell(t11, 'Present', 'yo') === 'me visto', 'vestirse yo visto');
  ok(t11.gerundSe === 'vistiéndose', 'vestirse gerund se-form');
}
const t12 = Conj.table('dormirse');
if (t12) ok(t12.gerundSe === 'durmiéndose', 'dormirse gerund se-form');

/* imperfect subjunctive of regular -er: entendiera… */
const t13 = Conj.table('entender');
ok(t13 && anyCell(t13, 'Imperfect subj.', 'entendiera'), 'entender imperfect subj');
/* future/conditional of stem-changers stay regular */
const t14 = Conj.table('pensar');
ok(t14 && anyCell(t14, 'Future', 'pensaréis'), 'pensar future regular');

console.log(`\n${total} checks, ${fails} failure(s)`);
process.exit(fails ? 1 : 0);