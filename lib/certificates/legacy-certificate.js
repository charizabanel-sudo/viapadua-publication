// Certificate renderer migrated verbatim from the legacy adminrecords.html (layout positions are
// tied to the 1536x1024 artwork). Artwork now lives in /public/images/certificates/.
// Generated once by a migration helper; edit with care.

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const CERT_BG_DATA = {
    confirmation: '/images/certificates/confirmation.jpg',
    baptism: '/images/certificates/baptism.jpg',
    marriage: '/images/certificates/marriage.jpg'
};

function certKind(svc) {
    const s = (svc || '').toLowerCase();
    if (s.includes('confirmation') || s.includes('kumpil')) return 'confirmation';
    if (s.includes('marriage') || s.includes('wedding') || s.includes('kasal')) return 'marriage';
    if (s.includes('baptism') || s.includes('binyag')) return 'baptism';
    return 'generic';
}

// Only the fields that each certificate actually prints.
const CERT_FIELDS = {
    confirmation: [
        { key: 'fullName',     label: 'Name of Confirmand', full: true },
        { key: 'fatherName',   label: "Father's Name" },
        { key: 'motherName',   label: "Mother's Name" },
        { key: 'godparents',   label: 'Sponsors (Ninong / Ninang)', full: true },
        { key: 'baptizedAt',   label: 'Baptized At' },
        { key: 'baptizedDate', label: 'Date of Baptism' },
        { key: 'minister',     label: 'Confirming Bishop' },
        { key: 'witness',      label: 'Witness' }
    ],
    baptism: [
        { key: 'childName',  label: "Child's Name", full: true },
        { key: 'birthDate',  label: 'Birth Date' },
        { key: 'birthPlace', label: 'Birthplace' },
        { key: 'fatherName', label: "Father's Name" },
        { key: 'motherName', label: "Mother's Name" },
        { key: 'godparents', label: 'Godparents (Ninong / Ninang)', full: true },
        { key: 'witness',    label: 'Witness (optional)', full: true }
    ],
    marriage: [
        { key: 'groomName',  label: "Groom's Name" },
        { key: 'brideName',  label: "Bride's Name" },
        { key: 'witnesses',  label: 'Witnesses', full: true }
    ],
    generic: [
        { key: 'fullName', label: 'Name of Recipient', full: true }
    ]
};

// yyyy-mm-dd  ->  "January 1, 2020"   (anything else is left as typed)
function certFmtLong(v) {
    const s = certClean(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Build the starting values: saved certificate first, otherwise the parishioner's booking form.
function certPrefill(booking, cert) {
    const d = booking.details || {};
    const kind = certKind(booking.service);
    const pick = function () {
        for (let i = 0; i < arguments.length; i++) { const v = certClean(arguments[i]); if (v) return v; }
        return '';
    };
    const par = certSplitParents({
        fatherName: pick(cert.fatherName, d.fatherName),
        motherName: pick(cert.motherName, d.motherName),
        parents:    pick(cert.parents, d.parents)
    });
    const v = {
        dateGiven:    pick(cert.dateGiven, d.certEventDate, booking.date),
        place:        pick(cert.place, booking.location, 'San Antonio de Padua Parish'),
        priest:       certPriestName({ priest: cert.priest }),
        fatherName:   par.father,
        motherName:   par.mother,
        godparents:   pick(cert.godparents, d.godparents, d.sponsors, d.sponsorName),
        baptizedAt:   pick(cert.baptizedAt, d.baptizedAt),
        baptizedDate: pick(cert.baptizedDate, certFmtLong(d.baptizedDate)),
        birthDate:    pick(cert.birthDate, certFmtLong(d.childDob || d.birthDate)),
        birthPlace:   pick(cert.birthPlace, d.birthPlace),
        minister:     pick(cert.minister, 'Most Reverend Bishop'),
        witness:      certIsDefault(cert.witness, 'Witness') ? '' : certClean(cert.witness),
        witnesses:    pick(cert.witnesses, d.witnesses),
        groomName:    pick(cert.groomName, d.groomName),
        brideName:    pick(cert.brideName, d.brideName),
        nameDy:       Number(cert.nameDy) || 0,
        nameScale:    Number(cert.nameScale) || 100
    };
    if (kind === 'confirmation') {
        v.fullName = pick(cert.fullName, d.candidateName, d.confirmandName, d.certNameOnCert, d.fullName, d.bookFullName, booking.userName);
    } else if (kind === 'baptism') {
        v.childName = pick(cert.childName, d.childName, d.certNameOnCert, cert.fullName);
    } else if (kind === 'generic') {
        v.fullName = pick(cert.fullName, d.certNameOnCert, d.bookFullName, booking.userName);
    }
    return v;
}


function certClean(v) { return (v == null ? '' : String(v)).trim(); }

// Inline-editing mode (admin certificate editor only). Adds data-f markers on variable text and shows
// placeholders for empty optional fields. Printing always renders with EDIT = false, so printed/PDF
// certificates never contain markers, placeholders or editing controls.
let EDIT = false;
function certAttr(key, kind) { return EDIT && key ? ' data-f="' + key + '"' + (kind ? ' data-k="' + kind + '"' : '') : ''; }
function certPh(text) { return '<span class="edit-ph">' + escapeHtml(text) + '</span>'; }
function certIsDefault(v, def) { const s = certClean(v).toLowerCase(); return !s || s === String(def).toLowerCase(); }
function certOrdinal(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}
function certDateParts(displayDate) {
    const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(displayDate || '');
    if (!m) return { day: '', month: certClean(displayDate), year: '' };
    return { day: certOrdinal(Number(m[2])), month: m[1], year: m[3] };
}
function certIssuedDate() {
    return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
function certSplitParents(cert) {
    let father = certClean(cert.fatherName), mother = certClean(cert.motherName);
    if (father || mother) return { father: father, mother: mother };
    const raw = certClean(cert.parents);
    if (!raw) return { father: '', mother: '' };
    let parts = raw.split(/\s*(?:&|\+|;|\/|\band\b|\n)\s*/i).map(s => s.trim()).filter(Boolean);
    if (parts.length === 1 && (raw.match(/,/g) || []).length === 1) {
        parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    return { father: parts[0] || '', mother: parts.slice(1).join(' & ') };
}

// ---- tiny layout helpers (positions are taken from the 1536 x 1024 artwork) ----
function certPct(px, total) { return (px / total * 100).toFixed(3) + '%'; }
function certY(px) { return certPct(px, 1024); }
function certVal(v) { const s = certClean(v); return s ? escapeHtml(s) : '&nbsp;'; }
function certFl(v, minCqw, key, kind) { return '<span class="fl"' + certAttr(key, kind) + ' style="min-width:' + minCqw + 'cqw">' + certVal(v) + '</span>'; }
function certYear(year, key, kind) {
    if (!year) return '20' + certFl('', 4.6, key, kind);
    if (year.indexOf('20') === 0) return '20' + certFl(year.slice(2), 4.6, key, kind);
    return certFl(year, 6.5, key, kind);
}
function certRow(y, cls, inner) {
    return '<div class="cr ' + cls + '" style="top:' + certY(y) + '">' + inner + '</div>';
}
function certBox(x0, x1, y, cls, inner) {
    return '<div class="cx ' + cls + '" style="left:' + certPct(x0, 1536) + ';width:' + certPct(x1 - x0, 1536) + ';top:' + certY(y) + '">' + inner + '</div>';
}
// Name on the underline. The text is wrapped in .nmt and certFitRuntime() (below) measures the real
// baseline of the font and sits it just above the line, so the name is never floating too high.
// dy = manual nudge in artwork pixels (+ = lower, - = higher).
function certLine(x0, x1, y, inner, fontCqw, dy, key) {
    return '<div class="nm"' + certAttr(key) + ' data-dy="' + (Number(dy) || 0) + '" style="left:' + certPct(x0, 1536) + ';width:' + certPct(x1 - x0, 1536) + ';top:' + certY(y) + ';font-size:' + fontCqw + 'cqw"><span class="nmt">' + inner + '</span></div>';
}
function certNameSize(text, max, span, scalePct) {
    const n = Math.max(certClean(text).length, 1);
    const base = Math.max(1.9, Math.min(max, span / (0.38 * n)));
    const k = Number(scalePct) > 0 ? Number(scalePct) / 100 : 1;
    return (base * k).toFixed(2);
}
function certSig(x0, x1, y, title, name, value, ink, nameKey, valueKey) {
    const sv = certClean(value)
        ? '<div class="sv"' + certAttr(valueKey) + '>' + escapeHtml(certClean(value)) + '</div>'
        : (EDIT && valueKey ? '<div class="sv"' + certAttr(valueKey) + '>' + certPh('Add name') + '</div>' : '');
    const sn = certClean(name)
        ? '<div class="sn"' + certAttr(nameKey) + '>' + escapeHtml(certClean(name)) + '</div>'
        : (EDIT && nameKey ? '<div class="sn"' + certAttr(nameKey) + '>' + certPh('Add name') + '</div>' : '');
    return '<div class="sg" style="left:' + certPct(x0, 1536) + ';width:' + certPct(x1 - x0, 1536) + ';top:' + certY(y) + '">'
        + sv
        + (certClean(ink) ? '<div class="sig-ink">' + escapeHtml(certClean(ink)) + '</div>' : '')
        + '<div class="st">' + title + '</div>'
        + sn
        + '</div>';
}
// pairs: [label, value, key]  or  [label, [[key, value], ...], null, separator] for combined values
// (e.g. parents "Father & Mother", born "date at place"). Normal output is unchanged from the legacy page.
function certDetails(y, pairs) {
    const items = [];
    pairs.forEach(function (p) {
        const label = p[0], val = p[1], key = p[2];
        if (Array.isArray(val)) {
            const sep = p[3] || ' & ';
            const text = val.map(function (x) { return certClean(x[1]); }).filter(Boolean).join(sep);
            if (!EDIT) { if (text) items.push('<b>' + label + ':</b> ' + escapeHtml(text)); return; }
            items.push('<b>' + label + ':</b> ' + val.map(function (x) {
                return '<span' + certAttr(x[0]) + '>' + (certClean(x[1]) ? escapeHtml(certClean(x[1])) : certPh(x[2] || 'add')) + '</span>';
            }).join(escapeHtml(sep)));
            return;
        }
        const text = certClean(val);
        if (!EDIT || !key) { if (text) items.push('<b>' + label + ':</b> ' + escapeHtml(text)); return; }
        items.push('<b>' + label + ':</b> <span' + certAttr(key) + '>' + (text ? escapeHtml(text) : certPh('add')) + '</span>');
    });
    if (!items.length) return '';
    return certRow(y, 'det', items.join('<span class="dot"> &bull; </span>'));
}

// Sample priest used on every certificate (fake name for client privacy). Change it here.
const CERT_PRIEST_NAME = 'Rev. Fr. Antonio M. Delgado';
function certPriestName(cert) {
    const v = certClean(cert && cert.priest);
    return (!v || /^(the\s+)?(parish\s+priest|priest)$/i.test(v)) ? CERT_PRIEST_NAME : v;
}
// "Rev. Fr. Antonio M. Delgado"  ->  "A. M. Delgado"  (written in handwriting font as the signature)
function certSignatureText(name) {
    const parts = certClean(name).replace(/\b(rev|fr|father|msgr|monsignor|reverend)\b\.?/ig, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).map(p => p.charAt(0).toUpperCase() + '.').join(' ') + ' ' + parts[parts.length - 1];
}

// Runs INSIDE the certificate document (print window / preview frame).
//  1) sits every name on its underline using the real font baseline
//  2) waits for the web fonts before printing so the printout matches the screen
function certFitRuntime() {
    function fit() {
        window.__certFit = fit;
        var names = document.querySelectorAll('.nm');
        for (var i = 0; i < names.length; i++) {
            var nm = names[i];
            var t = nm.querySelector('.nmt');
            if (!t) continue;
            t.style.top = '0px';
            var p = t.querySelector('i.bp');
            if (!p) {
                p = document.createElement('i');
                p.className = 'bp';
                p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
                t.appendChild(p);
            }
            var fs = parseFloat(getComputedStyle(nm).fontSize) || 16;
            var lineTop = nm.getBoundingClientRect().bottom - 1.5;
            var base = p.getBoundingClientRect().bottom;
            var want = lineTop - 0.1 * fs;               // baseline sits just above the line
            var sheet = nm.closest('.cert-sheet');
            var k = (sheet ? sheet.getBoundingClientRect().width : 1536) / 1536;
            var dy = (parseFloat(nm.getAttribute('data-dy')) || 0) * k;
            t.style.top = (((want - base) + dy) / fs) + 'em';
        }
    }
    var origPrint = window.print;
    window.print = function () {
        var go = function () { fit(); setTimeout(function () { origPrint.call(window); }, 250); };
        if (document.fonts && document.fonts.ready) { document.fonts.ready.then(go); } else { go(); }
    };
    function init() { fit(); if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fit); } }
    if (document.readyState === 'complete') { init(); } else { window.addEventListener('load', init); }
    window.addEventListener('resize', fit);
    window.addEventListener('beforeprint', fit);
}
const CERT_PRINT_PATCH = '<script>(' + certFitRuntime.toString() + ')();<\/script>';

function certWrap(extraCls, bgFile, inner) {
    const img = bgFile
        ? '<img class="cert-bg" alt="" src="' + bgFile + '" onerror="this.style.visibility=\'hidden\'">'
        : '';
    return '<div class="cert-sheet ' + extraCls + '"><div class="cert-fallback"></div>' + img + inner + '</div>' + CERT_PRINT_PATCH;
}

function getCertificateHTML(booking, cert, opts) {
    EDIT = !!(opts && opts.edit);
    try {
        return buildCertificateHTML(booking, cert);
    } finally {
        EDIT = false;
    }
}

function buildCertificateHTML(booking, cert) {
    const svc = (booking.service || '').toLowerCase();
    const dateGiven = cert.dateGiven || booking.date || '';
    let displayDate = dateGiven;
    if (dateGiven && dateGiven.includes('-')) {
        const [y, m, d] = dateGiven.split('-').map(Number);
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            displayDate = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }
    }

    if (svc.includes('confirmation') || svc.includes('kumpil')) return buildConfirmationCert(cert, displayDate);
    if (svc.includes('marriage') || svc.includes('wedding') || svc.includes('kasal')) return buildMarriageCert(cert, displayDate);
    if (svc.includes('baptism') || svc.includes('binyag')) return buildBaptismalCert(cert, displayDate);
    return buildGenericCert(booking, cert, displayDate);
}

function buildConfirmationCert(cert, displayDate) {
    const name = certClean(cert.fullName);
    const place = certClean(cert.place) || 'San Antonio de Padua Parish';
    const minister = certClean(cert.minister) || 'Most Reverend';
    const priest = certPriestName(cert);
    const witness = certClean(cert.witness) || 'Witness';
    const d = certDateParts(displayDate);
    const inner = ''
        + certRow(413, 'caps', 'THIS IS TO CERTIFY THAT')
        + certLine(265, 1268, 490, certVal(name), certNameSize(name, 4.4, 60, cert.nameScale), cert.nameDy, 'fullName')
        + certRow(514, 'lbl', '(Name of Confirmand)')
        + certRow(604, 'para', 'has received the Sacrament of Confirmation<br>in accordance with the laws of the Catholic Church,<br>through the ministry of the Most Reverend Bishop,<br>and has been sealed with the gift of the Holy Spirit.')
        + certRow(698, 'given', 'Given on this ' + certFl(d.day, 9, 'dateGiven', 'date') + ' day of ' + certFl(d.month, 16, 'dateGiven', 'date') + ', ' + certYear(d.year, 'dateGiven', 'date'))
        + certRow(741, 'given', 'at ' + certFl(place, 34, 'place'))
        + certRow(776, 'lbl', '(Place of Confirmation)')
        + certDetails(817, [
            (cert.fatherName || cert.motherName || EDIT)
                ? ['Parents', [['fatherName', cert.fatherName, 'father'], ['motherName', cert.motherName, 'mother']], null, ' & ']
                : ['Parents', cert.parents],
            ['Sponsors', cert.godparents, 'godparents'],
            ['Baptized at', cert.baptizedAt, 'baptizedAt'], ['Date of Baptism', cert.baptizedDate, 'baptizedDate']
        ])
        + certSig(137, 545, 900, 'SIGNATURE OF CONFIRMING BISHOP', minister, '', '', 'minister')
        + certSig(596, 967, 900, 'SIGNATURE OF PARISH PRIEST', priest, '', certSignatureText(priest), 'priest')
        + certSig(1027, 1402, 900, 'SIGNATURE OF WITNESS', witness, '', '', 'witness');
    return certWrap('cert-confirmation', CERT_BG_DATA.confirmation, inner);
}

function buildMarriageCert(cert, displayDate) {
    const groom = certClean(cert.groomName);
    const bride = certClean(cert.brideName);
    const place = certClean(cert.place) || 'San Antonio de Padua Parish';
    const priest = certPriestName(cert);
    const d = certDateParts(displayDate);
    const inner = ''
        + certRow(303, 'caps', 'THIS IS TO CERTIFY THAT')
        + certLine(165, 704, 380, certVal(groom), certNameSize(groom, 3.8, 32, cert.nameScale), cert.nameDy, 'groomName')
        + certLine(817, 1372, 380, certVal(bride), certNameSize(bride, 3.8, 32, cert.nameScale), cert.nameDy, 'brideName')
        + certBox(165, 704, 408, 'lbl', '(Name of Groom)')
        + certBox(817, 1372, 408, 'lbl', '(Name of Bride)')
        + certRow(467, 'caps', 'HAVE ENTERED INTO HOLY MATRIMONY')
        + certRow(530, 'caps', 'ON THIS ' + certFl(d.day, 12, 'dateGiven', 'date') + ' DAY OF ' + certFl(d.month, 19, 'dateGiven', 'date') + ', ' + certYear(d.year, 'dateGiven', 'date'))
        + certRow(593, 'caps', 'AT ' + certFl(place, 58, 'place'))
        + certRow(626, 'lbl', '(Place of Ceremony)')
        + certRow(705, 'caps sm', 'IN ACCORDANCE WITH THE LAWS OF THE REPUBLIC OF THE PHILIPPINES<br>AND THE TEACHINGS OF THE HOLY CHURCH.')
        + certDetails(766, [['Witnesses', cert.witnesses, 'witnesses']])
        + certSig(163, 641, 812, 'SIGNATURE OF GROOM')
        + certSig(896, 1373, 812, 'SIGNATURE OF BRIDE')
        + certSig(163, 641, 912, 'SIGNATURE OF OFFICIANT', priest, '', certSignatureText(priest), 'priest')
        + certSig(896, 1373, 912, 'DATE ISSUED', '', certIssuedDate());
    return certWrap('cert-marriage', CERT_BG_DATA.marriage, inner);
}

function buildBaptismalCert(cert, displayDate) {
    const childName = certClean(cert.childName) || certClean(cert.fullName);
    const place = certClean(cert.place) || 'San Antonio de Padua Parish';
    const priest = certPriestName(cert);
    const witness = certIsDefault(cert.witness, 'Witness') ? '' : certClean(cert.witness);
    const parents = certSplitParents(cert);
    const d = certDateParts(displayDate);
    const inner = ''
        + certRow(345, 'caps', 'THIS IS TO CERTIFY THAT')
        + certLine(190, 1345, 424, certVal(childName), certNameSize(childName, 4.4, 70, cert.nameScale), cert.nameDy, 'childName')
        + certRow(450, 'lbl', '(Name of Child)')
        + certRow(520, 'caps', 'WAS BAPTIZED ON THE ' + certFl(d.day, 9, 'dateGiven', 'date') + ' DAY OF ' + certFl(d.month, 16, 'dateGiven', 'date') + ', ' + certYear(d.year, 'dateGiven', 'date'))
        + certRow(592, 'caps', 'AT ' + certFl(place, 70, 'place'))
        + certRow(627, 'lbl', '(Name of Church / Place of Baptism)')
        + certRow(695, 'caps', 'ACCORDING TO THE RITES OF THE HOLY CATHOLIC CHURCH.')
        + certDetails(730, [
            ['Born', [['birthDate', cert.birthDate, 'birth date'], ['birthPlace', cert.birthPlace, 'birthplace']], null, ' at '],
            ['Godparents', cert.godparents, 'godparents'], ['Witness', witness, 'witness']
        ])
        + certSig(158, 727, 815, 'SIGNATURE OF PRIEST / MINISTER', priest, '', certSignatureText(priest), 'priest')
        + certSig(848, 1380, 815, 'NAME OF FATHER', '', parents.father, '', '', 'fatherName')
        + certSig(158, 727, 915, 'NAME OF MOTHER', '', parents.mother, '', '', 'motherName')
        + certSig(848, 1380, 915, 'DATE ISSUED', '', certIssuedDate());
    return certWrap('cert-baptism', CERT_BG_DATA.baptism, inner);
}

function buildGenericCert(booking, cert, displayDate) {
    const name = certClean(cert.fullName) || certClean(booking.userName);
    const place = certClean(cert.place) || 'San Antonio de Padua Parish';
    const priest = certPriestName(cert);
    const d = certDateParts(displayDate);
    const inner = ''
        + certRow(95, 'caps head', 'SAN ANTONIO DE PADUA PARISH')
        + certRow(135, 'caps sub', 'BARANGAY PONSO, POLANGUI, ALBAY')
        + certRow(235, 'gtitle', escapeHtml(booking.service || 'Certificate'))
        + certRow(330, 'caps big', 'CERTIFICATE')
        + certRow(389, 'caps', 'THIS IS TO CERTIFY THAT')
        + certLine(265, 1268, 490, certVal(name), certNameSize(name, 3.8, 60, cert.nameScale), cert.nameDy, 'fullName')
        + certRow(514, 'lbl', '(Name of Recipient)')
        + certRow(608, 'para', 'has completed the service of <b>' + escapeHtml(booking.service || '') + '</b><br>at San Antonio de Padua Parish.')
        + certRow(713, 'given', 'Given on this ' + certFl(d.day, 9, 'dateGiven', 'date') + ' day of ' + certFl(d.month, 16, 'dateGiven', 'date') + ', ' + certYear(d.year, 'dateGiven', 'date'))
        + certRow(753, 'given', 'at ' + certFl(place, 34, 'place'))
        + certSig(596, 967, 866, 'SIGNATURE OF PARISH PRIEST', priest, '', certSignatureText(priest), 'priest');
    return certWrap('cert-generic', '', inner);
}

function getCertificateCSS() {
    return `
@font-face{font-family:'EB Garamond';font-style:italic;font-weight:400;font-display:block;src:url('/fonts/eb-garamond-latin-400-italic.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:normal;font-weight:400;font-display:block;src:url('/fonts/eb-garamond-latin-400-normal.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:italic;font-weight:500;font-display:block;src:url('/fonts/eb-garamond-latin-500-italic.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:normal;font-weight:500;font-display:block;src:url('/fonts/eb-garamond-latin-500-normal.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:italic;font-weight:600;font-display:block;src:url('/fonts/eb-garamond-latin-600-italic.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:normal;font-weight:600;font-display:block;src:url('/fonts/eb-garamond-latin-600-normal.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:italic;font-weight:700;font-display:block;src:url('/fonts/eb-garamond-latin-700-italic.woff2') format('woff2');}
@font-face{font-family:'EB Garamond';font-style:normal;font-weight:700;font-display:block;src:url('/fonts/eb-garamond-latin-700-normal.woff2') format('woff2');}
@font-face{font-family:'Great Vibes';font-style:normal;font-weight:400;font-display:block;src:url('/fonts/great-vibes-latin-400-normal.woff2') format('woff2');}
@font-face{font-family:'Mrs Saint Delafield';font-style:normal;font-weight:400;font-display:block;src:url('/fonts/mrs-saint-delafield-latin-400-normal.woff2') format('woff2');}
        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        html, body { background: #ecebe4; }
        body { padding: 0; font-family: 'EB Garamond', 'Cormorant Garamond', Garamond, 'Times New Roman', Georgia, serif; }

        .cert-sheet { container-type: inline-size; position: relative; width: min(100%, calc((100vh - 76px) * 1.5)); aspect-ratio: 3 / 2; margin: 0 auto; background: #fbfbf2; overflow: hidden; color: #1c1a14; box-shadow: 0 4px 20px rgba(0,0,0,0.18); }
        .cert-fallback { position: absolute; inset: 1.4%; border: 0.45cqw double #b8960c; }
        .cert-bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

        .cr { position: absolute; left: 0; right: 0; text-align: center; transform: translateY(-50%); white-space: nowrap; }
        .cx { position: absolute; text-align: center; transform: translateY(-50%); white-space: nowrap; }

        .caps { font-size: 1.7cqw; letter-spacing: 0.1em; font-weight: 500; text-transform: uppercase; }
        .caps.sm { font-size: 1.42cqw; line-height: 1.7; letter-spacing: 0.085em; }
        .caps.head { font-size: 2.6cqw; letter-spacing: 0.1em; font-weight: 600; }
        .caps.sub { font-size: 1.4cqw; letter-spacing: 0.22em; }
        .caps.big { font-size: 2.8cqw; letter-spacing: 0.4em; font-weight: 700; }
        .gtitle { font-family: 'Great Vibes', 'Brush Script MT', cursive; font-size: 7cqw; color: #b8960c; line-height: 1.1; }
        .lbl { font-size: 1.5cqw; font-style: italic; color: #26231b; }
        .para { font-size: 1.78cqw; line-height: 1.95; letter-spacing: 0.01em; }
        /* Four paragraph lines must fit between the name label and the date row. */
        .cert-confirmation .para { line-height: 1.35; }
        .given { font-size: 1.8cqw; letter-spacing: 0.01em; }

        .det { white-space: normal; padding: 0 11%; font-size: 1.28cqw; font-style: italic; line-height: 1.4; color: #3a3222; }
        .det b { font-style: normal; font-weight: 600; letter-spacing: 0.04em; color: #26231b; }
        .det .dot { color: #b8960c; font-style: normal; }
        .cert-confirmation .det { font-size: 1.1cqw; line-height: 1.3; }

        .fl { display: inline-block; border-bottom: 1.5px solid #1c1a14; text-align: center; padding: 0 0.8cqw; margin: 0 0.3cqw; font-size: 2.05cqw; font-style: italic; font-weight: 600; letter-spacing: 0.02em; text-transform: none; color: #14110a; line-height: 1.25; }

        .nm { position: absolute; transform: translateY(-100%); border-bottom: 1.5px solid #1c1a14; text-align: center; white-space: nowrap; font-family: 'Great Vibes', 'Brush Script MT', cursive; line-height: 1.2; color: #14110a; padding: 0 0.5cqw; min-height: 1.2em; }
        .nm .nmt { display: inline-block; position: relative; line-height: 1.2; }

        .sg { position: absolute; border-top: 1.5px solid #1c1a14; text-align: center; }
        .sg .st { font-size: 1.22cqw; letter-spacing: 0.08em; font-weight: 600; margin-top: 0.55cqw; line-height: 1.2; }
        .sg .sn { font-size: 1.32cqw; font-style: italic; color: #3a3222; margin-top: 0.25cqw; line-height: 1.2; }
        .sg .sig-ink { position: absolute; left: 0; right: 0; bottom: 100%; margin-bottom: -0.25cqw; text-align: center; white-space: nowrap; font-family: 'Mrs Saint Delafield', 'Great Vibes', 'Brush Script MT', cursive; font-size: 3.6cqw; line-height: 1; color: #14308a; transform: rotate(-3deg); pointer-events: none; }
        .sg .sv { position: absolute; left: 0; right: 0; bottom: 100%; padding-bottom: 0.4cqw; text-align: center; white-space: nowrap; font-size: 1.95cqw; font-style: italic; font-weight: 600; color: #14110a; line-height: 1.15; }

        .edit-ph { color: #b8960c; opacity: 0.8; font-style: italic; font-weight: 500; }
        @page { size: 297mm 198mm; margin: 0; }
        @media print {
            html, body { background: #ffffff; }
            body { padding: 0; }
            .cert-sheet { width: 100%; box-shadow: none; }
            body > div:not(.cert-sheet) { display: none !important; }
        }
    `;
}


export { CERT_FIELDS, certKind, certPrefill, getCertificateHTML, getCertificateCSS };
