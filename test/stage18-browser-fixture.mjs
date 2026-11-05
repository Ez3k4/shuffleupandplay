import { writeFileSync,readFileSync } from 'node:fs'
import { buildPlayer } from '../src/game/player.ts'
import { roomPayload } from '../src/game/room-snapshot.ts'
import { renderComponent } from '../src/server/render/components.ts'
const card=(instanceId,name,typeLine)=>({instanceId,name,scryfallId:'x',imageUrl:'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2290%22%20height=%22130%22%3E%3Crect%20width=%2290%22%20height=%22130%22%20fill=%22navy%22/%3E%3C/svg%3E',artCropUrl:'',typeLine,tapped:false,isManaSource:false})
const elf={...card('c1','Test Elf','Creature — Elf'),x:180,y:120,isCreature:true,printedPower:'2',printedToughness:'3',counters:[]}
const island={...card('land1','Island','Basic Land — Island'),x:80,y:90,isLand:true,counters:[]}
const p={...buildPlayer({name:'Alice',sessionId:'session',seat:1,identifier:'alice'}),deckName:'test',deckStatus:'loaded',battlefield:[elf,island],hand:[card('hand1','Hidden Magic','Instant')]}
const room={id:'room',code:'DEMO',name:'Table',version:1,maxPlayers:4,players:[p],createdAt:'',updatedAt:''}
const payload=roomPayload({room,sessionId:'session'})
const component=renderComponent({name:'player',key:'1',context:{payload,roomCode:'DEMO',seat:1,shareUrl:'/tables/DEMO'}})
const html=`<!doctype html><html><head><meta charset="UTF-8"><style>${readFileSync(new URL('../public/application.css',import.meta.url),'utf8')}\nbody{margin:0;background:#101820}main{min-height:900px;display:block}#players-area{height:780px;width:1000px;position:relative;display:block}#players-area>.player-section{position:relative;min-height:780px}.your-seat .battlefield{height:600px}.your-seat .battlefield-canvas{position:relative;height:470px;width:900px}.your-seat .player-zones{position:relative;height:220px}.your-seat .hand-strip{position:absolute;bottom:0;left:220px}.stage17-stats{z-index:90} .your-seat .zone-summary-actions{z-index:5000} </style></head><body>
<main data-game data-table-type="GameRoom" data-table-code="DEMO" data-components="[]" data-seat="1" data-current-player-id="" data-worker-url="">
<div class="compact-tabletop-toolbar"><div id="component-opponentRoster"></div></div>
<div id="players-area">${component}</div>
<button data-copy-text="https://example.test/t/DEMO">Copy invite link</button>
<form data-deck-search><input name="q" value="sample"><button>Search</button></form>
<div data-deck-results></div>
</main><div data-toast-region></div><div id="card-hover-preview"><img id="card-hover-preview-image"><span id="card-hover-preview-name"></span></div>
</body></html>`
writeFileSync(process.argv[2]||'stage18-fixture.html',html)
