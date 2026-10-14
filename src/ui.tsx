import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

export type View = {
  server: string
  client: string
}

function row(text: string, color: Color4) {
  return (
    <Label
      value={text}
      fontSize={16}
      color={color}
      textAlign="middle-center"
      uiTransform={{ minWidth: 640, minHeight: 24, margin: { top: 2, bottom: 2 } }}
    />
  )
}

export function setupUi(getView: () => View) {
  ReactEcsRenderer.setUiRenderer(() => {
    const view = getView()
    return (
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          position: { top: 8, left: 0 },
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{ flexDirection: 'column', padding: 10, alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.65) }}
        >
          {row(view.server, Color4.Yellow())}
          {row(view.client, Color4.White())}
        </UiEntity>
      </UiEntity>
    )
  })
}
