import {BossBrowser,liveBossProfile} from '../../apps/worker/src/boss-browser';
const [origin,directory]=process.argv.slice(2);
if(!origin||!directory||new URL(origin).hostname!=='127.0.0.1')throw Error('Only local fixture origins are accepted');
const browser=new BossBrowser({engine:'patchright',moliExecutable:'moli',origin,profile:liveBossProfile(origin),profileDirectory:directory,headedFallback:false});
try{const state=await browser.openSession();const evidence=await browser.observeControls();process.stdout.write(JSON.stringify({state:state.state,accountObserved:state.accountMarker!==null,mutationsAllowed:browser.mutationsAllowed,evidence})+'\n');}
finally{await browser.close();}
