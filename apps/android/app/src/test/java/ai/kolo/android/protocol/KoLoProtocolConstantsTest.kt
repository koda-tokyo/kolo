package ai.kolo.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class KoLoProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", KoLoCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", KoLoCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", KoLoCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", KoLoCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", KoLoCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", KoLoCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", KoLoCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", KoLoCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", KoLoCapability.Canvas.rawValue)
    assertEquals("camera", KoLoCapability.Camera.rawValue)
    assertEquals("screen", KoLoCapability.Screen.rawValue)
    assertEquals("voiceWake", KoLoCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", KoLoScreenCommand.Record.rawValue)
  }
}
