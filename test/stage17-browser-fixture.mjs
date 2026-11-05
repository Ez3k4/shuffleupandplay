import {readFileSync,writeFileSync} from 'node:fs'
import {renderComponent} from '../src/server/render/components.ts'
import {buildPlayer} from '../src/game/player.ts'
import {roomPayload} from '../src/game/room-snapshot.ts'
const elf={instanceId:'creature',name:'Test Elf',scryfallId:'test',imageUrl:'',printedPower:'2',printedToughness:'3',typeLine:'Creature — Elf',isCreature:true,tapped:false,isManaSource:false,x:180,y:180,counters:[]}
const p={...buildPlayer({name:'Alice',sessionId:'s1',seat:1,identifier:'p1'}),deckName:'test',deckStatus:'loaded',battlefield:[elf]}
const room={id:'r',code:'TEST',name:'test',version:2,idleSweepAt:null,maxPlayers:4,players:[p],createdAt:'',updatedAt:''}
const payload=roomPayload({room,sessionId:'s1'})
const component=renderComponent({name:'player',key:'1',context:{payload,roomCode:'TEST',seat:1,shareUrl:'/t/TEST'}})
const source=readFileSync(new URL('../public/shuffle.js',import.meta.url),'utf8')
const logic=source.slice(source.indexOf('function wireStage17StatControls'),source.indexOf('// ===== Stage 08: bring last touched'))
const css=readFileSync(new URL('../public/application.css',import.meta.url),'utf8')
const html=`<!doctype html><meta charset="utf-8"><style>${css}\nbody{margin:0;min-height:800px} #players-area{position:relative;width:100%;height:760px;display:block}.player-section{position:relative;height:100%}.stage17-stats{z-index:20000!important}</style><div id="players-area">${component}</div>
<div class="stage7-land-menu" style="position:fixed;top:45%;left:45%;z-index:4000;background:#24343b; padding:20px;" hidden><select class="stage7-land-select"><option value="creature">Test Elf</option></select><button type="button" data-stage17-open-tokens="true">Create token</button><button type="button" data-stage17-copy-fixed="true">Copy</button></div>
<script>window.actions=[];const sendAction=(actorId,action)=>{window.actions.push({actorId,action});return Promise.resolve(true)};${logic}
wireStage17StatControls('TEST');wireStage17TokenPicker('TEST');document.addEventListener('click',ev=>{let b=ev.target.closest('[data-game-action]');if(b)window.actions.push({actorId:'TEST',action:JSON.parse(b.dataset.gameAction)})});</script>`
writeFileSync(process.argv[2] || 'stage17-fixture.html', html)
console.log('fixture size',html.length)
