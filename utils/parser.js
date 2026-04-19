const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');

async function parseDocx(buffer) {
    const zip = new AdmZip(buffer);
    const xmlContent = zip.readAsText('word/document.xml');

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        trimValues: false // Crucial to keep spaces between runs
    });

    const jsonObj = parser.parse(xmlContent);
    const body = jsonObj['w:document']['w:body'];
    const paragraphs = Array.isArray(body['w:p']) ? body['w:p'] : [body['w:p']];

    // Phase 1: Flatten document into tokens with broad color detection
    let chunks = [];
    paragraphs.forEach(p => {
        if (!p) return;

        let isNumbered = false;
        const pPr = p['w:pPr'];
        if (pPr && pPr['w:numPr']) {
            isNumbered = true;
        }

        const runs = Array.isArray(p['w:r']) ? p['w:r'] : [p['w:r']];
        let runTextPrefix = (isNumbered ? "\n[[NUM]] " : "");
        
        runs.forEach((r) => {
            if (!r) return;
            
            // Check for space-only runs (w:t with xml:space="preserve")
            const t = r['w:t'];
            if (!t && !r['w:tab'] && !r['w:br']) return;
            
            let text = "";
            if (t) {
                text = (typeof t === 'string') ? t : (t['#text'] || "");
            } else if (r['w:tab']) {
                text = "    ";
            } else if (r['w:br']) {
                text = "\n";
            }

            // Replace special characters but keep spaces
            text = text.replace(/[\u200B\u200C\u200D\u200E\u200F]/g, "");

            const rPr = r['w:rPr'];
            let isRed = false;
            if (rPr && rPr['w:color']) {
                const color = rPr['w:color']['@_w:val'];
                if (color) {
                    const c = color.toUpperCase();
                    if (/^(FF0000|C00000|ED1C24|FE0000|EE1D23|FF3333|EE0000|RED)$/.test(c)) {
                        isRed = true;
                    }
                }
            }
            chunks.push({ text: runTextPrefix + text, isRed });
            runTextPrefix = "";
        });
        chunks.push({ text: "\n", isRed: false });
    });

    let fullText = "";
    let redMap = [];
    chunks.forEach(c => {
        for (let i = 0; i < c.text.length; i++) {
            fullText += c.text[i];
            redMap.push(c.isRed);
        }
    });

    // Phase 2: Split with Aggressive Label Detection
    // Matches A. B. C. D. anywhere to handle cases where they are merged with text
    const splitRegex = /(Câu\s*\d*|\[\[NUM\]\]|[A-D][\.\)])/gi;

    let matches = [];
    let match;
    while ((match = splitRegex.exec(fullText)) !== null) {
        const label = match[1];
        const isQuestion = label.match(/Câu|\[\[NUM\]\]/i);

        matches.push({
            type: isQuestion ? 'QUESTION' : 'OPTION',
            label: label,
            index: match.index,
            length: label.length
        });
    }

    let questions = [];
    for (let i = 0; i < matches.length; i++) {
        const currentMatch = matches[i];
        const nextIndex = i + 1 < matches.length ? matches[i + 1].index : fullText.length;

        let segmentText = fullText.substring(currentMatch.index + currentMatch.length, nextIndex).trim();
        const segmentIsRed = redMap.slice(currentMatch.index, nextIndex).some(r => r === true);

        // Fix: If a segment contains a leaked label or is just noise, clean it
        segmentText = segmentText.replace(/\s*Câu\s*\d*$/gi, "");

        if (currentMatch.type === 'QUESTION') {
            questions.push({
                content: segmentText,
                options: []
            });
        } else if (currentMatch.type === 'OPTION' && questions.length > 0) {
            questions[questions.length - 1].options.push({
                text: segmentText,
                isCorrect: segmentIsRed
            });
        }
    }

    // Final clean-up and structure verification
    return questions
        .filter(q => q.content && q.options.length > 0)
        .map(q => {
            // Ensure at least one correct answer or mark first as fallback if needed (optional)
            // But here we want accuracy, so we keep what we found.
            return {
                ...q,
                options: q.options.map(opt => ({
                    ...opt,
                    text: opt.text.replace(/^[A-D][\.\)]\s*/i, "").trim()
                }))
            };
        });
}

module.exports = { parseDocx };
