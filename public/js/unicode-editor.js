// unicode-editor.js
// Attaches a lightweight unicode formatting toolbar to a textarea.
// Outputs real unicode chars so text renders anywhere without a parser.
//
// Usage: attachUnicodeEditor(textarea, { optional wrapperClass })

const BOLD_MAP = {
  A:'𝗔',B:'𝗕',C:'𝗖',D:'𝗗',E:'𝗘',F:'𝗙',G:'𝗚',H:'𝗛',I:'𝗜',J:'𝗝',K:'𝗞',L:'𝗟',M:'𝗠',
  N:'𝗡',O:'𝗢',P:'𝗣',Q:'𝗤',R:'𝗥',S:'𝗦',T:'𝗧',U:'𝗨',V:'𝗩',W:'𝗪',X:'𝗫',Y:'𝗬',Z:'𝗭',
  a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',k:'𝗸',l:'𝗹',m:'𝗺',
  n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇',
  '0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵',
};
const ITALIC_MAP = {
  A:'𝘈',B:'𝘉',C:'𝘊',D:'𝘋',E:'𝘌',F:'𝘍',G:'𝘎',H:'𝘏',I:'𝘐',J:'𝘑',K:'𝘒',L:'𝘓',M:'𝘔',
  N:'𝘕',O:'𝘖',P:'𝘗',Q:'𝘘',R:'𝘙',S:'𝘚',T:'𝘛',U:'𝘜',V:'𝘝',W:'𝘞',X:'𝘟',Y:'𝘠',Z:'𝘡',
  a:'𝘢',b:'𝘣',c:'𝘤',d:'𝘥',e:'𝘦',f:'𝘧',g:'𝘨',h:'𝘩',i:'𝘪',j:'𝘫',k:'𝘬',l:'𝘭',m:'𝘮',
  n:'𝘯',o:'𝘰',p:'𝘱',q:'𝘲',r:'𝘳',s:'𝘴',t:'𝘵',u:'𝘶',v:'𝘷',w:'𝘸',x:'𝘹',y:'𝘺',z:'𝘻',
};

function toUnicode(str, map) {
  return [...str].map(ch => map[ch] ?? ch).join('');
}

function wrapSelection(ta, transformFn) {
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const val   = ta.value;
  const selected = val.slice(start, end);
  if (!selected) return;
  const replaced = transformFn(selected);
  ta.value = val.slice(0, start) + replaced + val.slice(end);
  ta.selectionStart = start;
  ta.selectionEnd   = start + replaced.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

function wrapLines(ta, prefix) {
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const val   = ta.value;
  const selected = val.slice(start, end) || '';
  const lines = selected.split('\n').map(l => {
    if (l.startsWith(prefix)) return l.slice(prefix.length);
    return prefix + l;
  }).join('\n');
  ta.value = val.slice(0, start) + lines + val.slice(end);
  ta.selectionStart = start;
  ta.selectionEnd   = start + lines.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

export function attachUnicodeEditor(ta) {
  const toolbar = document.createElement('div');
  toolbar.className = 'ue-toolbar';
  toolbar.innerHTML = `
    <button type="button" data-action="bold"      title="Bold">𝗕</button>
    <button type="button" data-action="italic"    title="Italic">𝘐</button>
    <div class="ue-sep"></div>
    <button type="button" data-action="bullet"    title="Bullet list">• List</button>
    <button type="button" data-action="line"      title="Divider">― Line</button>
    <div class="ue-sep"></div>
    <button type="button" data-action="undo"      title="Undo (Ctrl+Z)">↩ Undo</button>
  `;

  toolbar.addEventListener('mousedown', e => e.preventDefault()); // keep textarea focus

  toolbar.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'bold':
        wrapSelection(ta, s => toUnicode(s, BOLD_MAP));
        break;
      case 'italic':
        wrapSelection(ta, s => toUnicode(s, ITALIC_MAP));
        break;
      case 'bullet':
        wrapLines(ta, '• ');
        break;
      case 'line':
        // Insert a divider line at cursor
        const pos = ta.selectionEnd;
        const divider = '\n――――――――――\n';
        ta.value = ta.value.slice(0, pos) + divider + ta.value.slice(pos);
        ta.selectionStart = ta.selectionEnd = pos + divider.length;
        ta.focus();
        ta.dispatchEvent(new Event('input'));
        break;
      case 'undo':
        document.execCommand('undo');
        ta.focus();
        break;
    }
  });

  // Keyboard shortcuts
  ta.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      wrapSelection(ta, s => toUnicode(s, BOLD_MAP));
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      wrapSelection(ta, s => toUnicode(s, ITALIC_MAP));
    }
  });

  ta.parentNode.insertBefore(toolbar, ta);
}
