/**
 * San.Lab — DocxWriter.gs
 * Сборка документов Word (DOCX) и ZIP-архивов на чистом JavaScript: работает одинаково в Apps Script и в демо.
 * ZIP без сжатия (метод «stored») — его открывают Word, LibreOffice, Google Документы и любой архиватор.
 * Документ описывается блоками: title, sub, kv, h, p, table, pagebreak.
 */

var Bytes = {
  utf8: function (s) {
    s = String(s === null || s === undefined ? '' : s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  },
  _crcTable: null,
  crc32: function (bytes) {
    var t = Bytes._crcTable;
    if (!t) {
      t = Bytes._crcTable = [];
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },
  base64: function (bytes) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = [], i;
    for (i = 0; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out.push(A.charAt(n >> 18 & 63) + A.charAt(n >> 12 & 63) + A.charAt(n >> 6 & 63) + A.charAt(n & 63));
    }
    var rest = bytes.length - i;
    if (rest === 1) { var a = bytes[i] << 16; out.push(A.charAt(a >> 18 & 63) + A.charAt(a >> 12 & 63) + '=='); }
    else if (rest === 2) { var b = (bytes[i] << 16) | (bytes[i + 1] << 8); out.push(A.charAt(b >> 18 & 63) + A.charAt(b >> 12 & 63) + A.charAt(b >> 6 & 63) + '='); }
    return out.join('');
  }
};

var Zip = {
  /* entries: [{ name, data: строка (UTF-8) или массив байт }] → массив байт архива */
  build: function (entries, when) {
    var out = [], central = [], offset = 0;
    var d = when ? new Date(when) : new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var u16 = function (arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF); };
    var u32 = function (arr, v) { arr.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); };
    var push = function (arr, bytes) { for (var i = 0; i < bytes.length; i++) arr.push(bytes[i]); };
    entries.forEach(function (e) {
      var name = Bytes.utf8(e.name), data = typeof e.data === 'string' ? Bytes.utf8(e.data) : e.data, crc = Bytes.crc32(data);
      var h = [];
      u32(h, 0x04034B50); u16(h, 20); u16(h, 0x0800); u16(h, 0); u16(h, dosTime); u16(h, dosDate);
      u32(h, crc); u32(h, data.length); u32(h, data.length); u16(h, name.length); u16(h, 0);
      push(out, h); push(out, name); push(out, data);
      var c = [];
      u32(c, 0x02014B50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, 0); u16(c, dosTime); u16(c, dosDate);
      u32(c, crc); u32(c, data.length); u32(c, data.length); u16(c, name.length); u16(c, 0); u16(c, 0); u16(c, 0); u16(c, 0); u32(c, 0); u32(c, offset);
      push(c, name);
      central.push(c);
      offset += h.length + name.length + data.length;
    });
    var cdStart = offset, cdSize = 0;
    central.forEach(function (c) { push(out, c); cdSize += c.length; });
    var e = [];
    u32(e, 0x06054B50); u16(e, 0); u16(e, 0); u16(e, entries.length); u16(e, entries.length); u32(e, cdSize); u32(e, cdStart); u16(e, 0);
    push(out, e);
    return out;
  }
};

var Docx = {
  PAGE_W: 16838, PAGE_H: 11906, MARGIN: 737,
  x: function (s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  run: function (text, o) {
    o = o || {};
    var rpr = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>' + (o.bold ? '<w:b/><w:bCs/>' : '') + (o.italic ? '<w:i/>' : '') +
      (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + (o.size ? '<w:sz w:val="' + o.size + '"/><w:szCs w:val="' + o.size + '"/>' : '') + (o.caps ? '<w:caps/>' : '') + '</w:rPr>';
    return String(text === null || text === undefined ? '' : text).split('\n').map(function (part, i) {
      return '<w:r>' + rpr + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + Docx.x(part) + '</w:t></w:r>';
    }).join('');
  },
  para: function (text, o) {
    o = o || {};
    var ppr = '<w:pPr>' + (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keepNext ? '<w:keepNext/>' : '') +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after === undefined ? 80 : o.after) + '"/>' + (o.align ? '<w:jc w:val="' + o.align + '"/>' : '') + '</w:pPr>';
    return '<w:p>' + ppr + Docx.run(text, o) + '</w:p>';
  },
  cell: function (text, w, o) {
    o = o || {};
    return '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + (o.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>' : '') + '</w:tcPr>' +
      Docx.para(text, { bold: o.bold, size: o.size || 16, after: 0 }) + '</w:tc>';
  },
  table: function (head, rows, widths, o) {
    o = o || {};
    var total = Docx.PAGE_W - 2 * Docx.MARGIN, n = (head || rows[0] || []).length;
    var ws = widths && widths.length === n ? widths : null, sum = 0;
    if (ws) ws.forEach(function (w) { sum += w; });
    var cols = []; for (var i = 0; i < n; i++) cols.push(Math.floor(total * (ws ? ws[i] / sum : 1 / n)));
    var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) { return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="' + (o.border || '000000') + '"/>'; }).join('') + '</w:tblBorders>';
    var h = '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/>' + b + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
      cols.map(function (c) { return '<w:gridCol w:w="' + c + '"/>'; }).join('') + '</w:tblGrid>';
    if (head) h += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + head.map(function (t, i) { return Docx.cell(t, cols[i], { bold: true, fill: o.headFill || 'DCE6F1', size: o.size }); }).join('') + '</w:tr>';
    rows.forEach(function (r) {
      h += '<w:tr><w:trPr><w:cantSplit/>' + (o.rowHeight ? '<w:trHeight w:val="' + o.rowHeight + '"/>' : '') + '</w:trPr>' + cols.map(function (c, i) { return Docx.cell(r[i], c, { bold: o.boldFirst && i === 0, size: o.size }); }).join('') + '</w:tr>';
    });
    return h + '</w:tbl>' + Docx.para('', { after: 60 });
  },
  body: function (blocks) {
    return blocks.map(function (b) {
      switch (b.t) {
        case 'title': return Docx.para(b.text, { bold: true, size: 30, align: 'center', after: 60, caps: true });
        case 'sub': return Docx.para(b.text, { size: 16, align: 'center', color: '444444', after: 120 });
        case 'kv': return Docx.table(null, b.rows, [1, 1], { boldFirst: true, size: 16 });
        case 'h': return Docx.para(b.text, { style: 'Heading2', keepNext: true, before: 200, after: 80 });
        case 'p': return Docx.para(b.text, { bold: b.bold, italic: b.italic, size: b.small ? 16 : 18, align: b.align, after: b.after });
        case 'table': return Docx.table(b.head, b.rows, b.widths, { size: b.size, rowHeight: b.rowHeight });
        case 'pagebreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        default: return '';
      }
    }).join('');
  },
  /* → массив байт файла .docx */
  build: function (blocks, opts) {
    opts = opts || {};
    var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    var sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="' + Docx.PAGE_W + '" w:h="' + Docx.PAGE_H + '" w:orient="landscape"/>' +
      '<w:pgMar w:top="' + Docx.MARGIN + '" w:right="' + Docx.MARGIN + '" w:bottom="' + Docx.MARGIN + '" w:left="' + Docx.MARGIN + '" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + '><w:body>' + Docx.body(blocks) + sect + '</w:body></w:document>';
    var footer = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + W + '>' + Docx.para(opts.footer || '', { size: 14, align: 'center', color: '444444', after: 0 }) + '</w:ftr>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
    var title = Docx.x(opts.title || '');
    var files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + title + '</dc:title><dc:creator>San.Lab</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + (opts.created || new Date().toISOString()).slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>' },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/footer1.xml', data: footer }
    ];
    return Zip.build(files, opts.created);
  }
};
