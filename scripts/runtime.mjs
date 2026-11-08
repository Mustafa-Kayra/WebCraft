import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const revision = 'd9e759ec21fdb807742201b11de8835e34ccd48a';
const stamp = `${revision}-singleplayer-3`;
const destination = 'public/runtime';
if (await readFile(`${destination}/version.txt`, 'utf8').catch(() => '') !== stamp) {
  const temp = await mkdtemp(join(tmpdir(), 'webcraft-'));
  try {
    execFileSync('git', ['clone', '--no-checkout', 'https://github.com/JessePinkman27/eaglercraft-1.12.2.git', temp], { stdio: 'inherit' });
    execFileSync('git', ['-C', temp, 'checkout', revision], { stdio: 'inherit' });
    await mkdir(destination, { recursive: true });
    await cp(`${temp}/web/js`, destination, { recursive: true });
    let source = await readFile(`${destination}/classes.js`, 'utf8');
    for (const [screen, id] of [['GuiMainMenu', 2], ['GuiIngameMenu', 7]]) {
      const draw = `    function nmcg_${screen}_drawScreen($this, $mouseX, $mouseY, $partialTicks) {`;
      const action = `        main: while (true) { switch ($ptr) {\n        case 0:`;
      const start = source.indexOf(`    function nmcg_${screen}_actionPerformed(`);
      const position = source.indexOf(action, start);
      if (!source.includes(draw) || start < 0 || position < 0) throw new Error(`Unsupported runtime: ${screen}`);
      source = source.slice(0, position) + source.slice(position).replace(action, `${action}\n            if ($button.$id1 === ${id}) return;`);
      source = source.replace(draw, `${draw}\n        for (var i = 0; i < $this.$buttonList.$size0; i++) {\n            var button = $this.$buttonList.$array1.data[i];\n            if (button.$id1 === ${id}) { button.$visible0 = 0; button.$enabled1 = 0; }\n        }`);
    }
    const drawStart = source.indexOf('    function nmcg_GuiWorldSelection_drawScreen(');
    const clickStart = source.indexOf('    function nmcg_GuiWorldSelection_mouseClicked(');
    if (drawStart < 0 || clickStart < 0) throw new Error('Unsupported world selection runtime');
    const drawSource = source.slice(drawStart, clickStart);
    const patchedDraw = drawSource.replace('        case 3:\n            nleo_GlStateManager_pushMatrix();', '        case 3:\n            $ptr = 16;\n            continue main;\n            nleo_GlStateManager_pushMatrix();');
    if (drawSource === patchedDraw) throw new Error('Shared world draw patch did not apply');
    source = source.slice(0, drawStart) + patchedDraw + source.slice(clickStart);
    const clickSignature = '    function nmcg_GuiWorldSelection_mouseClicked($this, $mouseX, $mouseY, $mouseButton) {';
    source = source.replace(clickSignature, `${clickSignature}\n        if ($mouseY < 12) return;`);
    const defaultLanguage = '$this.$language = $rt_s(182);';
    if (!source.includes(defaultLanguage)) throw new Error('Default language patch did not apply');
    source = source.replace(defaultLanguage, '$this.$language = $rt_str("tr_tr");');
    await writeFile(`${destination}/classes.js`, source);
    await writeFile(`${destination}/version.txt`, stamp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
console.log(`Runtime ready: ${stamp}`);
