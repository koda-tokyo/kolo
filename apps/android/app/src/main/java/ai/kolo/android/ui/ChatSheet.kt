package ai.kolo.android.ui

import androidx.compose.runtime.Composable
import ai.kolo.android.MainViewModel
import ai.kolo.android.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}
