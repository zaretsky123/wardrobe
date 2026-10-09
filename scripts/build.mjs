import {build} from 'esbuild';
import {rm,mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await copyFile('index.html','dist/index.html');
for(const name of await readdir('public'))await copyFile(`public/${name}`,`dist/${name}`);
if(process.env.SUPABASE_URL||process.env.SUPABASE_PUBLISHABLE_KEY){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_PUBLISHABLE_KEY)throw new Error('Both public Supabase settings are required.');
  await writeFile('dist/config.json',JSON.stringify({supabaseUrl:process.env.SUPABASE_URL,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY},null,2));
}
await build({entryPoints:['src/app.js'],bundle:true,minify:true,format:'esm',target:['es2022'],outfile:'dist/app.js',legalComments:'linked'});
await copyFile('src/app.css','dist/app.css');
const config=JSON.parse(await readFile('dist/config.json','utf8'));
console.log(`Built ${config.supabaseUrl?'connected':'setup-pending'} wardrobe in dist/`);
