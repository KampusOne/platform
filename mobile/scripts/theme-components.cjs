// One-time, syntax-aware mechanical migration. Keeps original light styles as
// fallbacks for pure helpers; React components subscribe to appearance changes.
const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
const root=path.resolve(__dirname,'..');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of [...walk(path.join(root,'app')),...walk(path.join(root,'src/components'))]) {
 if(!file.endsWith('.tsx'))continue;let source=fs.readFileSync(file,'utf8');if(source.includes('useThemeStyles')||!source.includes('StyleSheet.create')||!source.includes('const styles'))continue;
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const edits=[];
 for(const statement of ast.statements){
  if(ts.isFunctionDeclaration(statement)&&statement.name&&/^[A-Z]/.test(statement.name.text)&&statement.body){const text=statement.body.getText(ast);if(/\b(styles|theme)\b/.test(text))edits.push({start:statement.body.getStart(ast)+1,end:statement.body.getStart(ast)+1,text:'\n  const { theme, styles } = useThemeStyles(createStyles);\n'});}
  if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){if(declaration.name.getText(ast)==='styles'&&declaration.initializer&&declaration.initializer.getText(ast).startsWith('StyleSheet.create')){edits.push({start:declaration.name.getStart(ast),end:declaration.initializer.getStart(ast),text:'createStyles = (theme: Theme) => '});edits.push({start:statement.end,end:statement.end,text:'\nconst styles = createStyles(theme);'});}}
 }
 if(!edits.length)continue;edits.sort((a,b)=>b.start-a.start).forEach(e=>source=source.slice(0,e.start)+e.text+source.slice(e.end));
 // White translucent surfaces need a readable dark equivalent. Text/icon white
 // and illustration palettes are deliberately left alone.
 source=source.replace(/backgroundColor: (["'])(rgba\(255,\s*255,\s*255,[^"']+|#FFFFFF|#fff|#ffffff)\1/g,'backgroundColor: theme.surfaceGlassStrong');
 source='import { useThemeStyles, type Theme } from "@/src/lib/appearance";\n'+source;fs.writeFileSync(file,source);
}
