package com.fancyprint.edge.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Calendar

@Composable
fun QixiangRoot(
    daemonOnline: Boolean,
    batteryPercent: Int,
    statusLabel: String,
    onPrintRequest: (emoji: String, desc: String, type: String) -> Unit,
    onOpenSettings: () -> Unit,
) {
    var tab by remember { mutableStateOf<MainTab?>(null) }
    var settings by remember { mutableStateOf(false) }
    val works = remember { mutableStateListOf<WorkItem>() }
    var toast by remember { mutableStateOf<Pair<String, String>?>(null) }
    val scope = rememberCoroutineScope()

    fun formatDate(): String {
        val c = Calendar.getInstance()
        return "${c.get(Calendar.MONTH) + 1}月${c.get(Calendar.DAY_OF_MONTH)}日"
    }

    fun onPrint(emoji: String, desc: String, type: String) {
        works.add(0, WorkItem(System.currentTimeMillis().toString(), emoji, desc, type, formatDate(), false))
        toast = emoji to desc
        onPrintRequest(emoji, desc, type)
        scope.launch { delay(3000); toast = null }
    }

    Box(modifier = Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFFFEF6FF), Color(0xFFFDF2FF), Color(0xFFF0E8FF), Color(0xFFFCE7F3))))) {
        Box(modifier = Modifier.align(Alignment.TopStart).size(280.dp).offset((-60).dp).clip(CircleShape).background(Color(0x33C084FC)))
        Box(modifier = Modifier.align(Alignment.BottomEnd).size(240.dp).padding(50.dp).clip(CircleShape).background(Color(0x26F9A8D4)))
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                TopBar(daemonOnline, batteryPercent, statusLabel)
                Column(Modifier.weight(1f).fillMaxWidth()) {
                    if (works.isNotEmpty()) {
                        Text("你已经打印了 ${works.size} 个作品啦 🌟", Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), textAlign = TextAlign.Center, fontSize = 12.sp, color = Color(0xFFA78BBA))
                    }
                    HomeMenu(modifier = Modifier.weight(1f).fillMaxWidth(), onPick = { tab = it })
                }
                BottomBar(onSettings = { settings = true })
            }
            Column(Modifier.fillMaxSize()) {
                AnimatedVisibility(visible = tab != null && !settings, enter = fadeIn(), exit = fadeOut()) {
                    tab?.let { t ->
                        SubShell(tab = t, onBack = { tab = null }) {
                            when (t) {
                                MainTab.VOICE -> VoiceScreen(onPrint = ::onPrint)
                                MainTab.SEARCH -> LineArtScreen(onPrint = ::onPrint)
                                MainTab.BOOK -> QuietBookScreen(onPrint = ::onPrint)
                                MainTab.WORKS -> WorksScreen(
                                    works = works,
                                    onDelete = { id -> works.removeAll { it.id == id } },
                                    onToggle = { id -> works.indexOfFirst { it.id == id }.takeIf { it >= 0 }?.let { i -> works[i] = works[i].copy(starred = !works[i].starred) } },
                                    onPrintAgain = { w ->
                                        toast = w.emoji to w.desc
                                        onPrintRequest(w.emoji, w.desc, w.type)
                                        scope.launch { delay(3000); toast = null }
                                    },
                                )
                            }
                        }
                    }
                }
            }
            Column(Modifier.fillMaxSize()) {
                AnimatedVisibility(visible = settings, enter = fadeIn(), exit = fadeOut()) {
                    SettingsOverlay(
                        onBack = { settings = false },
                        onOpenSystemSettings = {
                            settings = false
                            onOpenSettings()
                        },
                    )
                }
            }
            toast?.let { (em, desc) ->
                Card(modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 72.dp, start = 24.dp, end = 24.dp).fillMaxWidth(0.85f), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = Color.Transparent)) {
                    Box(modifier = Modifier.background(Brush.linearGradient(listOf(Color(0xFFA855F7), Color(0xFFEC4899))), RoundedCornerShape(16.dp)).padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(em, fontSize = 28.sp)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text("正在打印中... 🖨️", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                Text(desc, color = Color.White.copy(alpha = 0.9f), fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                            IconButton(onClick = { toast = null }) {
                                Text("×", color = Color.White, fontSize = 22.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TopBar(daemonOnline: Boolean, batteryPercent: Int, statusLabel: String) {
    Row(modifier = Modifier.fillMaxWidth().background(Brush.horizontalGradient(listOf(Color(0xF2F3E8FF), Color(0xF2FCE7F3)))).border(2.dp, Color(0x2EC084FC)).padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(Brush.linearGradient(listOf(Color(0xFFA855F7), Color(0xFFEC4899)))), contentAlignment = Alignment.Center) { Text("🧸", fontSize = 20.sp) }
        Spacer(Modifier.width(10.dp))
        Column {
            Text("奇想印印", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
            Text("儿童打印站 ✨", fontSize = 11.sp, color = Color(0xFFA78BBA))
        }
        Spacer(Modifier.weight(1f))
        Pill(Icons.Default.Wifi, if (daemonOnline) "在线" else "离线", if (daemonOnline) Color(0xFFA855F7) else Color(0xFFDC2626), if (daemonOnline) Color(0xFFF3E8FF) else Color(0xFFFEE2E2))
        Spacer(Modifier.width(8.dp))
        Pill(Icons.Default.BatteryFull, "${batteryPercent.coerceAtLeast(0)}%", if (batteryPercent < 20) Color(0xFFDC2626) else Color(0xFF16A34A), if (batteryPercent < 20) Color(0xFFFEE2E2) else Color(0xFFDCFCE7))
        Spacer(Modifier.width(8.dp))
        Pill(Icons.Default.VolumeOff, statusLabel, Color(0xFFDB2777), Color(0xFFFCE7F3))
    }
}

@Composable
private fun Pill(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, fg: Color, bg: Color) {
    Row(modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = fg)
    }
}

@Composable
private fun BottomBar(onSettings: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().background(Brush.horizontalGradient(listOf(Color(0xE6FCE7F3), Color(0xE6F3E8FF)))).border(2.dp, Color(0x2EC084FC)).padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("🐻", fontSize = 16.sp)
        Spacer(Modifier.width(6.dp))
        Text("陪你一起创作的小伙伴", fontSize = 11.sp, color = Color(0xFFA78BBA), modifier = Modifier.weight(1f))
        OutlinedButton(onClick = onSettings, shape = RoundedCornerShape(999.dp), colors = ButtonDefaults.outlinedButtonColors(containerColor = Color.White), border = androidx.compose.foundation.BorderStroke(2.dp, Color(0x4DC084FC))) {
            Icon(Icons.Default.Settings, null, modifier = Modifier.size(18.dp), tint = Color(0xFF7E22CE))
            Spacer(Modifier.width(6.dp))
            Text("设置", fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
        }
    }
}

@Composable
private fun HomeMenu(modifier: Modifier = Modifier, onPick: (MainTab) -> Unit) {
    BoxWithConstraints(modifier.fillMaxSize().padding(horizontal = 95.dp, vertical = 8.dp)) {
        val cols = if (maxWidth > 700.dp) 4 else 2
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            LazyVerticalGrid(columns = GridCells.Fixed(cols), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth().wrapContentHeight()) {
                items(MainTab.entries) { t ->
                    Column(modifier = Modifier.clip(RoundedCornerShape(20.dp)).clickable { onPick(t) }.padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(modifier = Modifier.size(110.dp).clip(CircleShape).background(t.brush).border(5.dp, t.ring, CircleShape), contentAlignment = Alignment.Center) { Text(t.emoji, fontSize = 48.sp) }
                        Spacer(Modifier.height(8.dp))
                        Text(t.label, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
                        Text(t.subtitle, fontSize = 11.sp, color = Color(0xFFA78BBA), textAlign = TextAlign.Center)
                    }
                }
            }
        }
    }
}

@Composable
private fun SubShell(tab: MainTab, onBack: () -> Unit, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFFFAF5FF), Color(0xFFFEF3F9))))) {
        Row(modifier = Modifier.fillMaxWidth().background(tab.brush).border(3.dp, tab.ring).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledTonalButton(onClick = onBack, colors = ButtonDefaults.filledTonalButtonColors(containerColor = Color.White.copy(alpha = 0.35f))) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Color.White)
                Spacer(Modifier.width(4.dp))
                Text("返回", color = Color.White, fontWeight = FontWeight.Bold)
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) { content() }
    }
}

@Composable
private fun SettingsOverlay(onBack: () -> Unit, onOpenSystemSettings: () -> Unit) {
    Column(Modifier.fillMaxSize().background(Color(0xFFFAF5FF))) {
        Row(modifier = Modifier.fillMaxWidth().background(Brush.linearGradient(listOf(Color(0xFFC4B5FD), Color(0xFFFBCFE8)))).border(3.dp, Color(0xFFC084FC)).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FilledTonalButton(onClick = onBack, colors = ButtonDefaults.filledTonalButtonColors(containerColor = Color.White.copy(alpha = 0.35f))) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Color.White)
                Text("返回", color = Color.White, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(8.dp))
            Icon(Icons.Default.Settings, null, tint = Color(0xFF5B21B6))
            Text("设置", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Color(0xFF5B21B6))
        }
        Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("如需进入完整系统设置，请先通过家长锁验证。", color = Color(0xFF7E22CE), fontSize = 13.sp)
            OutlinedButton(onClick = onOpenSystemSettings) { Text("进入家长设置") }
        }
    }
}
