/* VocabES conjugation engine: European-Spanish verb conjugation for every verb in the deck.
   Pure JS, no DOM. Works as a classic browser script (sets window.Conj) and as a CJS
   module (module.exports), like core.cjs.

   Design: regular -ar/-er/-ir templates + orthography rules (-car/-gar/-zar/-guir/-gir,
   -cer/-cir zc) + per-verb stem-change map + fully irregular tables (incl. prefixed
   models: mantener, prevenir, presuponer, contradecir, desmentir, disentir, reducir,
   deducir …) + reflexive handling (se-forms, clitic imperatives with RAE orthography)
   + defective verbs (atañer, acaecer, incumbir). */
'use strict';
(function () {
  /* ---------- data ---------- */

  /* deck words that merely look like infinitives (never conjugate) */
  var EXCLUDE = { ayer: 1 };

  /* stem-changing verbs: type per head (ar/er: present only; ir: also pret/ger/subj) */
  var STEM = {
    pensar: 'e_ie', despertarse: 'e_ie', quebrar: 'e_ie', renegar: 'e_ie',
    perderse: 'e_ie', entender: 'e_ie',
    inferir: 'e_ie',
    discernir: 'e_ie_no',           /* diphthong in present only, no e→i elsewhere */
    soñar: 'o_ue', aprobar: 'o_ue', probar: 'o_ue', probarse: 'o_ue', acostarse: 'o_ue', acostar: 'o_ue',
    recordar: 'o_ue', costar: 'o_ue',
    devolver: 'o_ue', resolver: 'o_ue', soler: 'o_ue',
    dormirse: 'o_ue',
    jugar: 'u_ue',
    vestirse: 'e_i', despedir: 'e_i', seguir: 'e_i', conseguir: 'e_i', elegir: 'e_i'
  };

  /* -cer/-cir verbs that add -zco/-zca (others fall back to plain rules for custom words) */
  var ZC = { parecer: 1, merecer: 1, apetecer: 1, acaecer: 1, agradecer: 1, conocer: 1, aparecer: 1, ofrecer: 1 };
  /* -cer verbs that stay plain (c→z) instead of zc */
  var PLAIN_CER = { mecer: 1, cocer: 1, escocer: 1, zurcir: 1 };
  /* stem-vowel hiatus accent (prohíbo …) */
  var HIATUS = { prohibir: 1 };
  /* y-glide verbs: irregular preterite/gerund/participle, everything else regular */
  var YVERBS = {
    leer: { pret: ['leí', 'leíste', 'leyó', 'leímos', 'leísteis', 'leyeron'], ger: 'leyendo', part: 'leído' },
    creer: { pret: ['creí', 'creíste', 'creyó', 'creímos', 'creísteis', 'creyeron'], ger: 'creyendo', part: 'creído' }
  };
  /* participle overrides for otherwise-regular verbs */
  var PART = { escribir: 'escrito', devolver: 'devuelto', resolver: 'resuelto', volver: 'vuelto' };
  /* defective verbs: third person only */
  var DEFECTIVE = { atañer: 1, acaecer: 1, incumbir: 1 };

  /* endings */
  var AR = {
    pres: ['o', 'as', 'a', 'amos', 'áis', 'an'],
    pret: ['é', 'aste', 'ó', 'amos', 'asteis', 'aron'],
    imp: ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban'],
    fut: ['é', 'ás', 'á', 'emos', 'éis', 'án'],
    cond: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    sub: ['e', 'es', 'e', 'emos', 'éis', 'en'],
    isub: ['ara', 'aras', 'ara', 'áramos', 'arais', 'aran'],
    ger: 'ando', part: 'ado', vos: 'ad'
  };
  var ER = {
    pres: ['o', 'es', 'e', 'emos', 'éis', 'en'],
    pret: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
    imp: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    fut: ['é', 'ás', 'á', 'emos', 'éis', 'án'],
    cond: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    sub: ['a', 'as', 'a', 'amos', 'áis', 'an'],
    isub: ['iera', 'ieras', 'iera', 'iéramos', 'ierais', 'ieran'],
    ger: 'iendo', part: 'ido', vos: 'ed'
  };
  var IR = {
    pres: ['o', 'es', 'e', 'imos', 'ís', 'en'],
    pret: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'],
    imp: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    fut: ['é', 'ás', 'á', 'emos', 'éis', 'án'],
    cond: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'],
    sub: ['a', 'as', 'a', 'amos', 'áis', 'an'],
    isub: ['iera', 'ieras', 'iera', 'iéramos', 'ierais', 'ieran'],
    ger: 'iendo', part: 'ido', vos: 'id'
  };
  var CLASSES = { ar: AR, er: ER, ir: IR };

  /* fully irregular verbs — complete tables */
  /* entry: { cls, fut, pres[6], pret[6], imp[6], sub[6], isub[6], impv{tu,vos}, ger, part } */
  var IRREG = {
    dar: {
      cls: 'ar', fut: 'dar',
      pres: ['doy', 'das', 'da', 'damos', 'dais', 'dan'],
      pret: ['di', 'diste', 'dio', 'dimos', 'disteis', 'dieron'],
      imp: ['daba', 'dabas', 'daba', 'dábamos', 'dabais', 'daban'],
      sub: ['dé', 'des', 'dé', 'demos', 'deis', 'den'],
      isub: ['diera', 'dieras', 'diera', 'diéramos', 'dierais', 'dieran'],
      impv: { tu: 'da', vos: 'dad' }, ger: 'dando', part: 'dado'
    },
    ir: {
      cls: 'ir', fut: 'ir',
      pres: ['voy', 'vas', 'va', 'vamos', 'vais', 'van'],
      pret: ['fui', 'fuiste', 'fue', 'fuimos', 'fuisteis', 'fueron'],
      imp: ['iba', 'ibas', 'iba', 'íbamos', 'ibais', 'iban'],
      sub: ['vaya', 'vayas', 'vaya', 'vayamos', 'vayáis', 'vayan'],
      isub: ['fuera', 'fueras', 'fuera', 'fuéramos', 'fuerais', 'fueran'],
      impv: { tu: 've', nos: 'vamos', vos: 'id' }, ger: 'yendo', part: 'ido'
    },
    ser: {
      cls: 'er', fut: 'ser',
      pres: ['soy', 'eres', 'es', 'somos', 'sois', 'son'],
      pret: ['fui', 'fuiste', 'fue', 'fuimos', 'fuisteis', 'fueron'],
      imp: ['era', 'eras', 'era', 'éramos', 'erais', 'eran'],
      sub: ['sea', 'seas', 'sea', 'seamos', 'seáis', 'sean'],
      isub: ['fuera', 'fueras', 'fuera', 'fuéramos', 'fuerais', 'fueran'],
      impv: { tu: 'sé', vos: 'sed' }, ger: 'siendo', part: 'sido'
    },
    estar: {
      cls: 'ar', fut: 'estar',
      pres: ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'],
      pret: ['estuve', 'estuviste', 'estuvo', 'estuvimos', 'estuvisteis', 'estuvieron'],
      imp: ['estaba', 'estabas', 'estaba', 'estábamos', 'estabais', 'estaban'],
      sub: ['esté', 'estés', 'esté', 'estemos', 'estéis', 'estén'],
      isub: ['estuviera', 'estuvieras', 'estuviera', 'estuviéramos', 'estuvierais', 'estuvieran'],
      impv: { tu: 'está', vos: 'estad' }, ger: 'estando', part: 'estado'
    },
    tener: {
      cls: 'er', fut: 'tendr',
      pres: ['tengo', 'tienes', 'tiene', 'tenemos', 'tenéis', 'tienen'],
      pret: ['tuve', 'tuviste', 'tuvo', 'tuvimos', 'tuvisteis', 'tuvieron'],
      imp: ['tenía', 'tenías', 'tenía', 'teníamos', 'teníais', 'tenían'],
      sub: ['tenga', 'tengas', 'tenga', 'tengamos', 'tengáis', 'tengan'],
      isub: ['tuviera', 'tuvieras', 'tuviera', 'tuviéramos', 'tuvierais', 'tuvieran'],
      impv: { tu: 'ten', vos: 'tened' }, ger: 'teniendo', part: 'tenido'
    },
    mantener: {
      cls: 'er', fut: 'mantendr',
      pres: ['mantengo', 'mantienes', 'mantiene', 'mantenemos', 'mantenéis', 'mantienen'],
      pret: ['mantuve', 'mantuviste', 'mantuvo', 'mantuvimos', 'mantuvisteis', 'mantuvieron'],
      imp: ['mantenía', 'mantenías', 'mantenía', 'manteníamos', 'manteníais', 'mantenían'],
      sub: ['mantenga', 'mantengas', 'mantenga', 'mantengamos', 'mantengáis', 'mantengan'],
      isub: ['mantuviera', 'mantuvieras', 'mantuviera', 'mantuviéramos', 'mantuvierais', 'mantuvieran'],
      impv: { tu: 'mantén', vos: 'mantened' }, ger: 'manteniendo', part: 'mantenido'
    },
    sostener: {
      cls: 'er', fut: 'sostendr',
      pres: ['sostengo', 'sostienes', 'sostiene', 'sostenemos', 'sostenéis', 'sostienen'],
      pret: ['sostuve', 'sostuviste', 'sostuvo', 'sostuvimos', 'sostuvisteis', 'sostuvieron'],
      imp: ['sostenía', 'sostenías', 'sostenía', 'sosteníamos', 'sosteníais', 'sostenían'],
      sub: ['sostenga', 'sostengas', 'sostenga', 'sostengamos', 'sostengáis', 'sostengan'],
      isub: ['sostuviera', 'sostuvieras', 'sostuviera', 'sostuviéramos', 'sostuvierais', 'sostuvieran'],
      impv: { tu: 'sostén', vos: 'sostened' }, ger: 'sosteniendo', part: 'sostenido'
    },
    abstenerse: {
      cls: 'er', fut: 'abstendr',
      pres: ['abstengo', 'abstienes', 'abstiene', 'abstenemos', 'abstenéis', 'abstienen'],
      pret: ['abstuve', 'abstuviste', 'abstuvo', 'abstuvimos', 'abstuvisteis', 'abstuvieron'],
      imp: ['abstenía', 'abstenías', 'abstenía', 'absteníamos', 'absteníais', 'abstenían'],
      sub: ['abstenga', 'abstengas', 'abstenga', 'abstengamos', 'abstengáis', 'abstengan'],
      isub: ['abstuviera', 'abstuvieras', 'abstuviera', 'abstuviéramos', 'abstuvierais', 'abstuvieran'],
      impv: { tu: 'abstén', vos: 'abstened' }, ger: 'absteniendo', part: 'abstenido'
    },
    venir: {
      cls: 'ir', fut: 'vendr',
      pres: ['vengo', 'vienes', 'viene', 'venimos', 'venís', 'vienen'],
      pret: ['vine', 'viniste', 'vino', 'vinimos', 'vinisteis', 'vinieron'],
      imp: ['venía', 'venías', 'venía', 'veníamos', 'veníais', 'venían'],
      sub: ['venga', 'vengas', 'venga', 'vengamos', 'vengáis', 'vengan'],
      isub: ['viniera', 'vinieras', 'viniera', 'viniéramos', 'vinierais', 'vinieran'],
      impv: { tu: 'ven', vos: 'venid' }, ger: 'viniendo', part: 'venido'
    },
    prevenir: {
      cls: 'ir', fut: 'prevendr',
      pres: ['prevengo', 'previenes', 'previene', 'prevenimos', 'prevenís', 'previenen'],
      pret: ['previne', 'previniste', 'previno', 'previnimos', 'previnisteis', 'previnieron'],
      imp: ['prevenía', 'prevenías', 'prevenía', 'preveníamos', 'preveníais', 'prevenían'],
      sub: ['prevenga', 'prevengas', 'prevenga', 'prevengamos', 'prevengáis', 'prevengan'],
      isub: ['previniera', 'previnieras', 'previniera', 'previniéramos', 'previnierais', 'previnieran'],
      impv: { tu: 'prevén', vos: 'prevenid' }, ger: 'previniendo', part: 'prevenido'
    },
    sobrevenir: {
      cls: 'ir', fut: 'sobrevendr',
      pres: ['sobrevengo', 'sobrevienes', 'sobreviene', 'sobrevenimos', 'sobrevenís', 'sobrevienen'],
      pret: ['sobrevine', 'sobreviniste', 'sobrevino', 'sobrevinimos', 'sobrevinisteis', 'sobrevinieron'],
      imp: ['sobrevenía', 'sobrevenías', 'sobrevenía', 'sobreveníamos', 'sobreveníais', 'sobrevenían'],
      sub: ['sobrevenga', 'sobrevengas', 'sobrevenga', 'sobrevengamos', 'sobrevengáis', 'sobrevengan'],
      isub: ['sobreviniera', 'sobrevinieras', 'sobreviniera', 'sobreviniéramos', 'sobrevinierais', 'sobrevinieran'],
      impv: { tu: 'sobrevén', vos: 'sobrevenid' }, ger: 'sobreviniendo', part: 'sobrevenido'
    },
    poner: {
      cls: 'er', fut: 'pondr',
      pres: ['pongo', 'pones', 'pone', 'ponemos', 'ponéis', 'ponen'],
      pret: ['puse', 'pusiste', 'puso', 'pusimos', 'pusisteis', 'pusieron'],
      imp: ['ponía', 'ponías', 'ponía', 'poníamos', 'poníais', 'ponían'],
      sub: ['ponga', 'pongas', 'ponga', 'pongamos', 'pongáis', 'pongan'],
      isub: ['pusiera', 'pusieras', 'pusiera', 'pusiéramos', 'pusierais', 'pusieran'],
      impv: { tu: 'pon', vos: 'poned' }, ger: 'poniendo', part: 'puesto'
    },
    presuponer: {
      cls: 'er', fut: 'presupondr',
      pres: ['presupongo', 'presupones', 'presupone', 'presuponemos', 'presuponéis', 'presuponen'],
      pret: ['presupuse', 'presupusiste', 'presupuso', 'presupusimos', 'presupusisteis', 'presupusieron'],
      imp: ['presuponía', 'presuponías', 'presuponía', 'presuponíamos', 'presuponíais', 'presuponían'],
      sub: ['presuponga', 'presupongas', 'presuponga', 'presupongamos', 'presupongáis', 'presupongan'],
      isub: ['presupusiera', 'presupusieras', 'presupusiera', 'presupusiéramos', 'presupusierais', 'presupusieran'],
      impv: { tu: 'presupón', vos: 'presuponed' }, ger: 'presuponiendo', part: 'presupuesto'
    },
    oponerse: {
      cls: 'er', fut: 'opondr',
      pres: ['opongo', 'opones', 'opone', 'oponemos', 'oponéis', 'oponen'],
      pret: ['opuse', 'opusiste', 'opuso', 'opusimos', 'opusisteis', 'opusieron'],
      imp: ['oponía', 'oponías', 'oponía', 'oponíamos', 'oponíais', 'oponían'],
      sub: ['oponga', 'opongas', 'oponga', 'opongamos', 'opongáis', 'opongan'],
      isub: ['opusiera', 'opusieras', 'opusiera', 'opusiéramos', 'opusierais', 'opusieran'],
      impv: { tu: 'opón', vos: 'oponed' }, ger: 'oponiendo', part: 'opuesto'
    },
    decir: {
      cls: 'ir', fut: 'dir',
      pres: ['digo', 'dices', 'dice', 'decimos', 'decís', 'dicen'],
      pret: ['dije', 'dijiste', 'dijo', 'dijimos', 'dijisteis', 'dijeron'],
      imp: ['decía', 'decías', 'decía', 'decíamos', 'decíais', 'decían'],
      sub: ['diga', 'digas', 'diga', 'digamos', 'digáis', 'digan'],
      isub: ['dijera', 'dijeras', 'dijera', 'dijéramos', 'dijerais', 'dijeran'],
      impv: { tu: 'di', vos: 'decid' }, ger: 'diciendo', part: 'dicho'
    },
    contradecir: {
      cls: 'ir', fut: 'contradir',
      pres: ['contradigo', 'contradices', 'contradice', 'contradecimos', 'contradecís', 'contradicen'],
      pret: ['contradije', 'contradijiste', 'contradijo', 'contradijimos', 'contradijisteis', 'contradijeron'],
      imp: ['contradecía', 'contradecías', 'contradecía', 'contradecíamos', 'contradecíais', 'contradecían'],
      sub: ['contradiga', 'contradigas', 'contradiga', 'contradigamos', 'contradigáis', 'contradigan'],
      isub: ['contradijera', 'contradijeras', 'contradijera', 'contradijéramos', 'contradijerais', 'contradijeran'],
      impv: { tu: 'contradice', vos: 'contradecid' }, ger: 'contradiciendo', part: 'contradicho'
    },
    hacer: {
      cls: 'er', fut: 'har',
      pres: ['hago', 'haces', 'hace', 'hacemos', 'hacéis', 'hacen'],
      pret: ['hice', 'hiciste', 'hizo', 'hicimos', 'hicisteis', 'hicieron'],
      imp: ['hacía', 'hacías', 'hacía', 'hacíamos', 'hacíais', 'hacían'],
      sub: ['haga', 'hagas', 'haga', 'hagamos', 'hagáis', 'hagan'],
      isub: ['hiciera', 'hicieras', 'hiciera', 'hiciéramos', 'hicierais', 'hicieran'],
      impv: { tu: 'haz', vos: 'haced' }, ger: 'haciendo', part: 'hecho'
    },
    andar: {
      cls: 'ar', fut: 'andar',
      pres: ['ando', 'andas', 'anda', 'andamos', 'andáis', 'andan'],
      pret: ['anduve', 'anduviste', 'anduvo', 'anduvimos', 'anduvisteis', 'anduvieron'],
      imp: ['andaba', 'andabas', 'andaba', 'andábamos', 'andabais', 'andaban'],
      sub: ['ande', 'andes', 'ande', 'andemos', 'andéis', 'anden'],
      isub: ['anduviera', 'anduvieras', 'anduviera', 'anduviéramos', 'anduvierais', 'anduvieran'],
      impv: { tu: 'anda', vos: 'andad' }, ger: 'andando', part: 'andado'
    },
    desmentir: {
      cls: 'ir', fut: 'desmentir',
      pres: ['desmiento', 'desmientes', 'desmiente', 'desmentimos', 'desmentís', 'desmienten'],
      pret: ['desmentí', 'desmentiste', 'desmintió', 'desmentimos', 'desmentisteis', 'desmintieron'],
      imp: ['desmentía', 'desmentías', 'desmentía', 'desmentíamos', 'desmentíais', 'desmentían'],
      sub: ['desmienta', 'desmientas', 'desmienta', 'desmintamos', 'desmintáis', 'desmientan'],
      isub: ['desmintiera', 'desmintieras', 'desmintiera', 'desmintiéramos', 'desmintierais', 'desmintieran'],
      impv: { tu: 'desmiente', vos: 'desmentid' }, ger: 'desmintiendo', part: 'desmentido'
    },
    disentir: {
      cls: 'ir', fut: 'disentir',
      pres: ['disiento', 'disientes', 'disiente', 'disentimos', 'disentís', 'disienten'],
      pret: ['disentí', 'disentiste', 'disintió', 'disentimos', 'disentisteis', 'disintieron'],
      imp: ['disentía', 'disentías', 'disentía', 'disentíamos', 'disentíais', 'disentían'],
      sub: ['disienta', 'disientas', 'disienta', 'disintamos', 'disintáis', 'disientan'],
      isub: ['disintiera', 'disintieras', 'disintiera', 'disintiéramos', 'disintierais', 'disintieran'],
      impv: { tu: 'disiente', vos: 'disentid' }, ger: 'disintiendo', part: 'disentido'
    },
    reducir: {
      cls: 'ir', fut: 'reducir',
      pres: ['reduzco', 'reduces', 'reduce', 'reducimos', 'reducís', 'reducen'],
      pret: ['reduje', 'redujiste', 'redujo', 'redujimos', 'redujisteis', 'redujeron'],
      imp: ['reducía', 'reducías', 'reducía', 'reducíamos', 'reducíais', 'reducían'],
      sub: ['reduzca', 'reduzcas', 'reduzca', 'reduzcamos', 'reduzcáis', 'reduzcan'],
      isub: ['redujera', 'redujeras', 'redujera', 'redujéramos', 'redujerais', 'redujeran'],
      impv: { tu: 'reduce', vos: 'reducid' }, ger: 'reduciendo', part: 'reducido'
    },
    deducir: {
      cls: 'ir', fut: 'deducir',
      pres: ['deduzco', 'deduces', 'deduce', 'deducimos', 'deducís', 'deducen'],
      pret: ['deduje', 'dedujiste', 'dedujo', 'dedujimos', 'dedujisteis', 'dedujeron'],
      imp: ['deducía', 'deducías', 'deducía', 'deducíamos', 'deducíais', 'deducían'],
      sub: ['deduzca', 'deduzcas', 'deduzca', 'deduzcamos', 'deduzcáis', 'deduzcan'],
      isub: ['dedujera', 'dedujeras', 'dedujera', 'dedujéramos', 'dedujerais', 'dedujeran'],
      impv: { tu: 'deduce', vos: 'deducid' }, ger: 'deduciendo', part: 'deducido'
    },
    reír: {
      cls: 'ir', fut: 'reír',
      pres: ['río', 'ríes', 'ríe', 'reímos', 'reís', 'ríen'],
      pret: ['reí', 'reíste', 'rió', 'reímos', 'reísteis', 'rieron'],
      imp: ['reía', 'reías', 'reía', 'reíamos', 'reíais', 'reían'],
      sub: ['ría', 'rías', 'ría', 'riamos', 'riáis', 'rían'],
      isub: ['riera', 'rieras', 'riera', 'riéramos', 'rierais', 'rieran'],
      impv: { tu: 'ríe', vos: 'reíd' }, ger: 'riendo', part: 'reído'
    },
    sonreír: {
      cls: 'ir', fut: 'sonreír',
      pres: ['sonrío', 'sonríes', 'sonríe', 'sonreímos', 'sonreís', 'sonríen'],
      pret: ['sonreí', 'sonreíste', 'sonrió', 'sonreímos', 'sonreísteis', 'sonrieron'],
      imp: ['sonreía', 'sonreías', 'sonreía', 'sonreíamos', 'sonreíais', 'sonreían'],
      sub: ['sonría', 'sonrías', 'sonría', 'sonriamos', 'sonriáis', 'sonrían'],
      isub: ['sonriera', 'sonrieras', 'sonriera', 'sonriéramos', 'sonrierais', 'sonrieran'],
      impv: { tu: 'sonríe', vos: 'sonreíd' }, ger: 'sonriendo', part: 'sonreído'
    }
  };

  /* ---------- helpers ---------- */

  var VOWELS = 'aeiouáéíóúü';
  var ACCMAP = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
  var IR_CHANGE = { e_ie: 'i', o_ue: 'u', e_i: 'i' };   /* -ir 3rd-pret/ger/1pl-2pl-subj */

  function lower(s) { return String(s || '').toLowerCase(); }
  function unaccent(s) { return String(s).replace(/[áéíóú]/g, function (c) { return plain(c); }); }
  function plain(c) { var i = 'áéíóú'.indexOf(c); return i === -1 ? c : 'aeiou'.charAt(i); }

  /* vowel-run chunks (syllable approximation: split strong+strong hiatus, merge diphthongs) */
  function vowelRuns(w) {
    var runs = [], cur = '';
    function flush() { if (cur) runs.push(cur); cur = ''; }
    for (var i = 0; i < w.length; i++) {
      var c = w.charAt(i);
      if (VOWELS.indexOf(c) !== -1) {
        if (cur) {
          var a = plain(cur.charAt(cur.length - 1)), b = plain(c);
          if ('aeo'.indexOf(a) !== -1 && 'aeo'.indexOf(b) !== -1) flush();  /* a-e-o: hiatus → new syllable */
        }
        cur += c;
      } else flush();
    }
    flush();
    return runs;
  }

  /* stressed vowel {ch, idx}: written accent wins, else default written rules */
  function stressed(w) {
    for (var i = 0; i < w.length; i++) {
      var c = w.charAt(i);
      if (c === 'á' || c === 'é' || c === 'í' || c === 'ó' || c === 'ú') return { ch: c, idx: i };
    }
    var runs = vowelRuns(w);
    if (!runs.length) return { ch: '', idx: -1 };
    var lastChar = w.charAt(w.length - 1);
    var target = (VOWELS.indexOf(lastChar) !== -1 || lastChar === 'n' || lastChar === 's') ? Math.max(0, runs.length - 2) : runs.length - 1;
    var run = runs[target];
    /* associate vowel: strong (a/e/o) of a diphthong, else first */
    var ch = null;
    for (var k = 0; k < run.length; k++) {
      var v = plain(run.charAt(k));
      if (v === 'a' || v === 'e' || v === 'o') { ch = v; break; }
    }
    if (ch === null) ch = plain(run.charAt(run.length - 1));   /* weak+weak diphthong: stress the second (cuí, maquí…) */
    /* find the index of that vowel in w */
    var pos = 0, rIdx = -1;
    for (var r = 0; r <= target; r++) {
      rIdx = w.indexOf(runs[r], pos);
      pos = rIdx + runs[r].length;
    }
    for (var j = 0; j < run.length; j++) {
      if (plain(run.charAt(j)) === ch) return { ch: ch, idx: rIdx + j };
    }
    return { ch: ch, idx: rIdx };
  }

  /* i/u stressed + vowel adjacent (ignoring h) → tilde required (pa-ís, vestíos, le-í) */
  function hiatusNeedsTilde(s, idx) {
    var c = s.charAt(idx).toLowerCase();
    if (c !== 'i' && c !== 'u') return false;
    var prev = idx - 1;
    while (prev >= 0 && s.charAt(prev) === 'h') prev--;
    var next = idx + 1;
    while (next < s.length && s.charAt(next) === 'h') next++;
    var a = prev >= 0 ? s.charAt(prev).toLowerCase() : '';
    var b = next < s.length ? s.charAt(next).toLowerCase() : '';
    if (a && VOWELS.indexOf(a) !== -1) return true;
    if (b && VOWELS.indexOf(b) !== -1) return true;
    return false;
  }

  function addTilde(ch) { return ACCMAP[ch] || ch; }

  /* apply RAE written-accent rules to s whose stress sits at st.idx */
  function accentWord(s, st) {
    if (!st || st.idx < 0 || st.idx >= s.length) return s;
    if (hiatusNeedsTilde(s, st.idx)) {
      return s.slice(0, st.idx) + addTilde(plain(s.charAt(st.idx))) + s.slice(st.idx + 1);
    }
    var runs = vowelRuns(s);
    if (runs.length <= 1) return s;
    var lastChar = s.charAt(s.length - 1);
    var target = (VOWELS.indexOf(lastChar) !== -1 || lastChar === 'n' || lastChar === 's') ? runs.length - 2 : runs.length - 1;
    /* which run contains st.idx */
    var pos = 0, stRun = -1;
    for (var r = 0; r < runs.length; r++) {
      pos = s.indexOf(runs[r], pos);
      if (st.idx >= pos && st.idx < pos + runs[r].length) { stRun = r; break; }
      pos += runs[r].length;
    }
    if (stRun === target) return s;
    return s.slice(0, st.idx) + addTilde(plain(s.charAt(st.idx))) + s.slice(st.idx + 1);
  }

  /* attach an enclitic to an imperative/gerund with correct orthography */
  function cliticize(base, cl) {
    var st = stressed(base);
    var b = unaccent(base);                                       /* drop base tilde; re-decide below */
    if (cl === 'os' && /d$/.test(b) && b !== 'id') b = b.slice(0, -1);       /* levantad → levanta…; id → idos */
    if (cl === 'nos' && /mos$/.test(b)) b = b.slice(0, -1);                  /* levantemos → levantémonos */
    return accentWord(b + cl, st);
  }

  /* ---------- conjugation generation ---------- */

  function orthoStem(stem, endCh, cls, full) {
    var s = stem;
    var e = plain(endCh);
    if (cls === 'ar') {
      if (e === 'e') {
        if (/c$/.test(s)) s = s.slice(0, -1) + 'qu';        /* pagar → pagué */
        else if (/g$/.test(s)) s = s.slice(0, -1) + 'gu';   /* jugar → jugué */
        else if (/z$/.test(s)) s = s.slice(0, -1) + 'c';    /* cazar → cacé */
      }
    } else {
      if (e === 'o' || e === 'a') {
        if (/gu$/.test(s) && cls === 'ir') s = s.slice(0, -2) + 'g';   /* seguir → sigo/siga */
        else if (/g$/.test(s)) s = s.slice(0, -1) + 'j';               /* elegir → elijo; coger → cojo */
        else if (/c$/.test(s)) {                                        /* -cer/-cir */
          if (PLAIN_CER[full]) s = s.slice(0, -1) + 'z';               /* mecer → mezo */
          else s = s.slice(0, -1) + 'zc';                             /* parecer → parezco */
        }
      }
    }
    return s;
  }

  /* stem change (e→ie, o→ue, e→i, u→ue): the change hits the LAST stem vowel
     (the stressed one: despertar → despierto, recordar → recuerdo) */
  function lastVowel(stem, vowel, repl) {
    var i = stem.lastIndexOf(vowel);
    if (i === -1) return stem;
    return stem.slice(0, i) + repl + stem.slice(i + 1);
  }
  function diph(stem, type) {  /* present-tense change: e→ie / o→ue / u→ue / e→i */
    if (type === 'e_ie') return lastVowel(stem, 'e', 'ie');
    if (type === 'o_ue') return lastVowel(stem, 'o', 'ue');
    if (type === 'u_ue') return lastVowel(stem, 'u', 'ue');
    if (type === 'e_i') return lastVowel(stem, 'e', 'i');
    return stem;
  }
  function pretIr(stem, type) {  /* -ir 3rd-person preterite stem (mint-, durm-, vist-) */
    if (type === 'e_ie') return lastVowel(stem, 'e', 'i');
    if (type === 'o_ue') return lastVowel(stem, 'o', 'u');
    if (type === 'e_i') return lastVowel(stem, 'e', 'i');
    return stem;
  }
  /* accent the stressed (last) vowel of a stem: prohib → prohíb */
  function accentLastVowel(s) {
    for (var i = s.length - 1; i >= 0; i--) {
      var c = s.charAt(i);
      if ('aeiou'.indexOf(c) !== -1) return s.slice(0, i) + addTilde(c) + s.slice(i + 1);
    }
    return s;
  }
  function verbFull(stem, cls) { return stem + (cls === 'ar' ? 'ar' : cls === 'er' ? 'er' : 'ir'); }

  function buildTable(inf, o) {
    var T = CLASSES[o.cls];
    var stem = o.stem;
    var change = o.stemChange;          /* 'e_ie' | 'o_ue' | 'e_i' | 'u_ue' */
    var isIr = o.cls === 'ir';
    var i, s;
    var pres = [], pret = [], imp = [], sub = [], isub = [], fut = [], cond = [];

    var futStem = unaccent(inf);
    var dropI = o.cls !== 'ar' && /(ñ|ll)$/.test(stem);   /* tañer → tañó/tañeron; zambullir → zambulló */

    for (i = 0; i < 6; i++) {
      fut.push(futStem + T.fut[i]);
      cond.push(futStem + T.cond[i]);
    }
    /* present */
    for (i = 0; i < 6; i++) {
      var s1 = (change && { 0: 1, 1: 1, 2: 1, 5: 1 }[i]) ? diph(stem, change) : stem;
      if (o.discernir && (i === 3 || i === 4)) s1 = stem;               /* discernir: 1pl/2pl plain */
      if (o.hiatus && { 0: 1, 1: 1, 2: 1, 5: 1 }[i]) s1 = accentLastVowel(s1);
      pres.push(orthoStem(s1, T.pres[i].charAt(0), o.cls, verbFull(stem, o.cls)) + T.pres[i]);
    }
    /* preterite (y-verbs have dedicated forms: leí/leyó …; ñ/ll stems drop the -i-: tañó, bulló) */
    for (i = 0; i < 6; i++) {
      if (o.y) { pret.push(o.y.pret[i]); continue; }
      var sp = stem;
      if (dropI && (i === 2 || i === 5)) { pret.push(stem + (i === 2 ? 'ó' : 'eron')); continue; }
      if (isIr && change && !o.discernir && (i === 2 || i === 5)) sp = pretIr(stem, change);
      pret.push(orthoStem(sp, T.pret[i].charAt(0), o.cls, verbFull(stem, o.cls)) + T.pret[i]);
    }
    /* imperfect */
    for (i = 0; i < 6; i++) imp.push(stem + T.imp[i]);
    /* subjunctive stem per cell:
         -ar/-er: diphthong in all but 1pl/2pl (pienses / pensemos)
         -ir: diphthong in 1sg/2sg/3sg/3pl, e→i/o→u in 1pl/2pl (sientan / sintamos, duerman / durmamos)
         discernir: diphthong only, no 1pl/2pl change (disciernan / discernamos) */
    function subjStem(i) {
      if (!change) return stem;
      if (i === 3 || i === 4) {
        if (o.discernir) return stem;
        if (isIr && IR_CHANGE[change]) return lastVowel(stem, change === 'o_ue' ? 'o' : 'e', IR_CHANGE[change]);
        return stem;
      }
      return diph(stem, change);
    }
    for (i = 0; i < 6; i++) {
      var ss = subjStem(i);
      if (o.hiatus) ss = accentLastVowel(ss);
      sub.push(orthoStem(ss, T.sub[i].charAt(0), o.cls, verbFull(stem, o.cls)) + T.sub[i]);
    }
    /* imperfect subjunctive: y-verbs use the preterite 3rd stem (ley-/crey-);
       -ir stem-changers use the changed stem (infir-, durm-, vist-);
       ñ/ll stems drop the -i- (tañera, zambullera) */
    var isStem = stem;
    var isEnd = T.isub;
    if (o.y) {
      isStem = o.y.pret[2].replace(/ó$/, '');
      isEnd = ['era', 'eras', 'era', 'éramos', 'erais', 'eran'];
    } else if (dropI) {
      isEnd = ['era', 'eras', 'era', 'éramos', 'erais', 'eran'];
    } else if (isIr && change && !o.discernir && IR_CHANGE[change]) {
      isStem = lastVowel(stem, change === 'o_ue' ? 'o' : 'e', IR_CHANGE[change]);
    }
    for (i = 0; i < 6; i++) isub.push(orthoStem(isStem, isEnd[i].charAt(0), o.cls, verbFull(stem, o.cls)) + isEnd[i]);

    /* gerund + participle */
    var ger = stem + T.ger, part = stem + T.part;
    if (dropI) ger = stem + 'endo';
    if (isIr && change && !o.discernir && IR_CHANGE[change]) ger = lastVowel(stem, change === 'o_ue' ? 'o' : 'e', IR_CHANGE[change]) + T.ger;
    if (o.y) { ger = o.y.ger; part = o.y.part; }
    if (PART[inf]) part = PART[inf];

    var tu = pres[2];                                          /* hiatus stems already accented above */
    var vos = orthoStem(stem, T.vos.charAt(0), o.cls, verbFull(stem, o.cls)) + T.vos;

    return {
      pres: pres, pret: pret, imp: imp, sub: sub, isub: isub, fut: fut, cond: cond,
      ger: ger, part: part,
      imperative: { tu: tu, usted: sub[2], nosotros: sub[3], vosotros: vos, ustedes: sub[5] }
    };
  }

  /* ---------- public API ---------- */

  function classify(inf) {
    if (!inf) return null;
    if (EXCLUDE[inf] || EXCLUDE[inf.replace(/se$/, '')]) return null;
    var reflex = /se$/.test(inf);
    var base = reflex ? inf.slice(0, -2) : inf;
    if (IRREG[inf]) return { irreg: IRREG[inf], cls: IRREG[inf].cls, stem: null, reflex: reflex };
    if (reflex && IRREG[base]) return { irreg: IRREG[base], cls: IRREG[base].cls, stem: null, reflex: true };
    var m = base.match(/^(.*?)(ar|er|ir|ír)$/);
    if (!m) return null;
    var stem = m[1], cls = m[2] === 'ír' ? 'ir' : m[2];
    var full = m[1] + m[2];
    var o = { cls: cls, stem: stem, reflex: reflex };
    var st = STEM[full] || STEM[inf];
    if (st) { o.stemChange = st; if (st === 'e_ie_no') { o.stemChange = 'e_ie'; o.discernir = true; } }
    if (HIATUS[full] || HIATUS[inf]) o.hiatus = true;
    if (YVERBS[full] || YVERBS[inf]) o.y = YVERBS[full] || YVERBS[inf];
    if (DEFECTIVE[full] || DEFECTIVE[inf]) o.defective = true;
    return o;
  }

  function analyze(phrase) {
    var t = lower(phrase);
    if (!t) return null;
    t = t.replace(/^(no)\s+/, '');
    var parts = t.split(/\s+/);
    var head = parts[0] || '';
    if (!/^[a-záéíóúüñ]+(?:se)?$/.test(head)) return null;
    var r = classify(head);
    if (!r) {
      /* unknown infinitive-shaped word (e.g. imported cards): accept only real shapes */
      var hb = /se$/.test(head) ? head.slice(0, -2) : head;
      if (!/(?:ar|er|ir|ír)$/.test(hb)) return null;
      if (EXCLUDE[head] || EXCLUDE[hb]) return null;
    }
    var suffix = t.slice(head.length);
    return { head: head, base: /se$/.test(head) ? head.slice(0, -2) : head, reflex: /se$/.test(head), suffix: suffix };
  }

  var PRON = ['yo', 'tú', 'él/ella', 'nosotros', 'vosotros', 'ellos/ellas'];
  var REFL = ['me', 'te', 'se', 'nos', 'os', 'se'];
  var TENSE_META = [
    { key: 'pres', label: 'Present' },
    { key: 'pret', label: 'Preterite' },
    { key: 'imp', label: 'Imperfect' },
    { key: 'fut', label: 'Future' },
    { key: 'cond', label: 'Conditional' },
    { key: 'sub', label: 'Present subj.' },
    { key: 'isub', label: 'Imperfect subj.' }
  ];

  function table(head) {
    var a = analyze(head);
    if (!a) return null;
    var info = classify(a.head);
    if (!info) return null;
    var f;
    if (info.irreg) {
      var ir = info.irreg;
      var fut = [], cond = [], futStem = unaccent(ir.fut);
      for (var i = 0; i < 6; i++) { fut.push(futStem + CLASSES[ir.cls].fut[i]); cond.push(futStem + CLASSES[ir.cls].cond[i]); }
      f = {
        pres: ir.pres, pret: ir.pret, imp: ir.imp, sub: ir.sub, isub: ir.isub,
        fut: fut, cond: cond,
        ger: ir.ger, part: ir.part,
        imperative: { tu: ir.impv.tu, usted: ir.sub[2], nosotros: ir.impv.nos || ir.sub[3], vosotros: ir.impv.vos, ustedes: ir.sub[5] }
      };
    } else {
      f = buildTable(a.base, info);
    }
    var defective = !!info.defective;
    var o = {
      phrase: a.head, base: a.base, reflex: a.reflex, defective: defective, suffix: a.suffix,
      tenses: [], gerund: f.ger, participle: f.part, imperative: {}
    };
    var keep = defective ? [2, 5] : [0, 1, 2, 3, 4, 5];
    var PR = a.reflex ? REFL : null;
    TENSE_META.forEach(function (tm) {
      var rows = [];
      for (var k = 0; k < keep.length; k++) {
        var pi = keep[k];
        rows.push([PRON[pi], PR ? PR[pi] + ' ' + f[tm.key][pi] : f[tm.key][pi]]);
      }
      o.tenses.push({ label: tm.label, rows: rows });
    });
    if (!defective) {
      var clmap = { tu: 'te', usted: 'se', nosotros: 'nos', vosotros: 'os', ustedes: 'se' };
      ['tu', 'usted', 'nosotros', 'vosotros', 'ustedes'].forEach(function (k) {
        var v = f.imperative[k];
        if (a.reflex) v = cliticize(v, clmap[k]);
        o.imperative[k] = v;
      });
    } else {
      o.imperative = null;
      o.note = 'Defective verb — used in the 3rd person only.';
    }
    if (a.reflex) o.gerundSe = cliticize(f.ger, 'se');
    return o;
  }

  function knows(phrase) { return analyze(phrase) !== null; }

  var Conj = {
    analyze: analyze,
    table: table,
    knows: knows,
    IRREG: IRREG
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Conj;
  else if (typeof window !== 'undefined') window.Conj = Conj;
})();