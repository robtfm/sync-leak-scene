import {
  engine,
  Entity,
  Material,
  MeshRenderer,
  NetworkEntity,
  Schemas,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { setupUi } from './ui'

// Reproduction for the @dcl/sdk network sync-filter "first write" leak.
//
// The server owns CUBES synced entities. Each client writes a VisibilityComponent on its local
// mirrors (NOT in the sync list) and deletes it HIDE_SECONDS later. Nothing about that write
// should ever leave the client. What actually happens: the first write on each mirror has
// timestamp 1, the sync filter forwards any timestamp<=1 write on an entity that carries
// SyncComponents, the server accepts it, re-broadcasts it, and includes it in the state dump for
// every later joiner. The delete (timestamp 2) is never forwarded.
//
// What to look for:
//   first visit : cubes visible, hidden for HIDE_SECONDS, visible again (correct locally)
//                 the server text climbs to CUBES/CUBES (leak: the server now holds the hide)
//   reload/join : cubes never appear (state dump carries the leaked hide; this client sees them
//                 arrive already hidden and leaves them alone); server text stays at CUBES/CUBES

const CUBES = 8
const HIDE_SECONDS = 3

const LeakReport = engine.defineComponent('leak:report', {
  cubes: Schemas.Int,
  hiddenOnServer: Schemas.Int,
  tick: Schemas.Int
})

const tag = () => (isServer() ? 'server' : 'client')

function serverMain() {
  const cubes: Entity[] = []
  for (let i = 0; i < CUBES; i++) {
    const cube = engine.addEntity()
    Transform.create(cube, {
      position: Vector3.create(2.5 + i * 1.5, 1, 9),
      scale: Vector3.create(0.9, 0.9, 0.9)
    })
    MeshRenderer.setBox(cube)
    Material.setPbrMaterial(cube, { albedoColor: Color4.create(0.2, 0.8, 0.3, 1) })
    // sync list deliberately excludes VisibilityComponent
    syncEntity(cube, [Transform.componentId, MeshRenderer.componentId, Material.componentId])
    cubes.push(cube)
  }

  // the server's view, replicated to every client through the sync; rendered in the client UI
  const report = engine.addEntity()
  LeakReport.create(report, { cubes: CUBES, hiddenOnServer: 0, tick: 0 })
  syncEntity(report, [LeakReport.componentId], 1)

  let acc = 0
  engine.addSystem((dt) => {
    acc += dt
    if (acc < 1) return
    acc = 0
    const hidden = cubes.filter((c) => VisibilityComponent.getOrNull(c)?.visible === false).length
    const r = LeakReport.getMutable(report)
    r.hiddenOnServer = hidden
    r.tick += 1
    if (hidden > 0) console.log(`LEAK|server|hidden=${hidden}/${CUBES}`)
  })
}

function clientMain() {
  // per mirror: seconds since first seen; the hide is written on first sight, deleted at HIDE_SECONDS
  const seen = new Map<Entity, number>()
  const hiddenByMe = new Set<Entity>()

  engine.addSystem((dt) => {
    for (const [mirror] of engine.getEntitiesWith(MeshRenderer, NetworkEntity)) {
      const age = seen.get(mirror)
      if (age === undefined) {
        seen.set(mirror, 0)
        if (VisibilityComponent.has(mirror)) {
          // already hidden on arrival: the state dump carried someone else's leaked hide.
          // leave it alone so the late-joiner symptom stays visible
          console.log(`LEAK|client|arrived-hidden|${mirror}`)
          continue
        }
        // client-local write on a server-owned mirror; its FIRST write has timestamp 1
        VisibilityComponent.createOrReplace(mirror, { visible: false })
        hiddenByMe.add(mirror)
        console.log(`LEAK|client|hide|${mirror}`)
        continue
      }
      seen.set(mirror, age + dt)
      if (age + dt >= HIDE_SECONDS && hiddenByMe.has(mirror)) {
        hiddenByMe.delete(mirror)
        VisibilityComponent.deleteFrom(mirror)
        console.log(`LEAK|client|unhide|${mirror}`)
      }
    }
  })

  setupUi(() => {
    let mirrors = 0
    let hidden = 0
    for (const [mirror] of engine.getEntitiesWith(MeshRenderer, NetworkEntity)) {
      mirrors++
      if (VisibilityComponent.getOrNull(mirror)?.visible === false) hidden++
    }
    const leaked = hidden - hiddenByMe.size
    let server = 'SERVER report not received yet'
    for (const [, r] of engine.getEntitiesWith(LeakReport)) {
      server =
        `SERVER sees VisibilityComponent on ${r.hiddenOnServer}/${r.cubes} cubes` +
        ` (expected 0; anything else is the sync-filter leak) tick ${r.tick}`
    }
    return {
      server,
      client:
        `CLIENT mirrors ${mirrors}/${CUBES}, hidden ${hidden} (by me ${hiddenByMe.size}, leaked-in ${leaked}); ` +
        `my hide lasts ${HIDE_SECONDS}s then is deleted, leaked-in hides are never touched`
    }
  })
}

export function main() {
  console.log(`LEAK|${tag()}|main`)
  if (isServer()) serverMain()
  else clientMain()
}
