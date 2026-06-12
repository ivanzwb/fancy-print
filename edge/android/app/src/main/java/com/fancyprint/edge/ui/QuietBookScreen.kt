package com.fancyprint.edge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun QuietBookScreen(onPrint: (emoji: String, desc: String, type: String) -> Unit) {
    var btab by remember { mutableStateOf("scene") } // scene | characters | items
    var themeId by remember { mutableStateOf<String?>(null) }
    var placed by remember { mutableStateOf(listOf<PlacedSticker>()) }
    var saved by remember { mutableStateOf(false) }
    var printedScene by remember { mutableStateOf(false) }

    val st = themeId?.let { id -> AppData.quietThemes.find { it.id == id } }
    val pal = themeId?.let { AppData.quietPalette[it] }
    val themeSelected = themeId != null

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // ── Voice bar (visual only, no voice function on Android yet) ──
        Row(
            modifier = Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFFFDF4FF))
                .border(2.dp, Color(0x4DC084FC), RoundedCornerShape(16.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier.size(44.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xFFA855F7)),
                contentAlignment = Alignment.Center
            ) {
                Text("🎙️", fontSize = 18.sp)
            }
                    Column(Modifier.weight(1f)) {
                Text("📖 语音生成场景", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
                Text("说出你想要的场景，AI 帮你生成 ✨", fontSize = 10.sp, color = Color(0xFFA78BBA))
            }
        }

        // ── Body: left palette + right preview ──
        Row(
            modifier = Modifier.fillMaxWidth().weight(1f),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Left panel (34%)
            Column(
                modifier = Modifier.fillMaxHeight().fillMaxWidth(0.34f),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Three main tabs
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    listOf(
                        "scene" to "🎨\n场景",
                        "characters" to "👫\n人物",
                        "items" to "🎁\n物品"
                    ).forEach { (id, label) ->
                        val active = btab == id
                        Column(
                            modifier = Modifier.weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (active) Color(0xFFA855F7) else Color(0xFFF3E8FF))
                                .clickable { btab = id }
                                .padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                label, fontSize = 8.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (active) Color.White else Color(0xFF7C6A90),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center
                            )
                        }
                    }
                }

                // Scrollable content area
                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    if (btab == "scene") {
                        // Theme list (vertical)
                        Column(
                            modifier = Modifier.fillMaxSize()
                                .verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            AppData.quietThemes.forEach { theme ->
                                val sel = theme.id == themeId
                                Row(
                                    modifier = Modifier.fillMaxWidth()
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(
                                            if (sel) Brush.linearGradient(listOf(Color(0xFFA855F7), Color(0xFFEC4899)))
                                            else theme.bg
                                        )
                                        .border(
                                            if (sel) 2.dp else 2.dp,
                                            if (sel) Color(0xFFC084FC) else Color(0x2EC084FC),
                                            RoundedCornerShape(16.dp)
                                        )
                                        .clickable { themeId = theme.id; saved = false; printedScene = false }
                                        .padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Text(theme.emoji, fontSize = 24.sp)
            Column(Modifier.weight(1f)) {
                                        Text(
                                            theme.label,
                                            fontSize = 12.sp, fontWeight = FontWeight.Bold,
                                            color = if (sel) Color.White else Color(0xFF3D2A5A)
                                        )
                                        Text(
                                            theme.scene,
                                            fontSize = 14.sp,
                                            color = if (sel) Color.White.copy(alpha = 0.8f) else Color(0xFF7C6A90).copy(alpha = 0.7f)
                                        )
                                    }
                                    if (sel) {
                                        Text("✓", fontSize = 14.sp, color = Color.White, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                            if (themeId == null) {
                                Text(
                                    "点选一个场景开始创作 ✨",
                                    fontSize = 10.sp,
                                    color = Color(0xFFA78BBA),
                                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                                )
                            }
                        }
                    } else if (!themeSelected) {
                        // No theme selected
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("👈", fontSize = 28.sp)
                                Text(
                                    "先在「场景」tab 选一个主题",
                                    fontSize = 10.sp, color = Color(0xFFA78BBA)
                                )
                            }
                        }
                    } else {
                        // Sticker grid (3 columns)
                        val stickers = if (btab == "characters") pal?.characters ?: emptyList() else pal?.items ?: emptyList()
                        LazyVerticalGrid(
                            columns = GridCells.Fixed(3),
                            modifier = Modifier.fillMaxSize()
                                .clip(RoundedCornerShape(16.dp))
                                .background(Color(0xFFFAF5FF))
                                .border(2.dp, Color(0x33C084FC), RoundedCornerShape(16.dp))
                                .padding(6.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            items(stickers, key = { it.name }) { s ->
                                Column(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Color.White)
                                        .border(2.dp, Color(0x2EC084FC), RoundedCornerShape(12.dp))
                                        .clickable {
                                            placed = placed + PlacedSticker(
                                                id = "${System.currentTimeMillis()}-${Math.random()}",
                                                emoji = s.emoji, name = s.name,
                                                x = 15f + (Math.random() * 70).toFloat(),
                                                y = 20f + (Math.random() * 55).toFloat(),
                                                size = 28f + (Math.random() * 12).toFloat()
                                            )
                                        }
                                        .padding(6.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Text(s.emoji, fontSize = 22.sp)
                                    Text(s.name, fontSize = 8.sp, color = Color(0xFF7C6A90), maxLines = 1)
                                }
                            }
                        }
                    }
                }

                // Placed elements list
                if ((btab == "characters" || btab == "items") && placed.isNotEmpty()) {
                    Column(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color(0xFFFAF5FF))
                            .border(2.dp, Color(0x33C084FC), RoundedCornerShape(12.dp))
                            .padding(8.dp)
                            .fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "已加入 ${placed.size} 个",
                                fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE)
                            )
                            Text(
                                "清空",
                                fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFFF43F5E),
                                modifier = Modifier.clickable { placed = emptyList() }
                            )
                        }
                        placed.takeLast(4).forEach { p ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(p.emoji, fontSize = 14.sp)
                                Text(
                                    p.name, fontSize = 9.sp, color = Color(0xFF5B21B6),
                                    modifier = Modifier.weight(1f), maxLines = 1
                                )
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(99.dp))
                                        .background(Color(0xFFA855F7))
                                        .clickable {
                                            onPrint(p.emoji, p.name, "安静书")
                                        }
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text("⎙", fontSize = 9.sp, color = Color.White)
                                }
                                Text(
                                    "×", fontSize = 14.sp, color = Color(0xFFD1D5DB),
                                    modifier = Modifier.clickable {
                                        placed = placed.filter { it.id != p.id }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Right panel: preview + buttons
            Column(
                modifier = Modifier.weight(1f).fillMaxHeight(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (st != null) {
                    // Preview with theme
                    Box(
                        modifier = Modifier.fillMaxWidth().weight(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(st.bg)
                            .border(3.dp, Color(0x4DC084FC), RoundedCornerShape(16.dp))
                    ) {
                        // Scene background emojis
                        Text(
                            st.scene, fontSize = 56.sp,
                            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                            color = Color(0x33FFFFFF)
                        )

                        // Theme badge
                        Box(
                            modifier = Modifier.align(Alignment.TopStart)
                                .padding(8.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(Color(0xD0FFFFFF))
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        ) {
                            Text(
                                "${st.emoji} ${st.label}",
                                fontSize = 9.sp, fontWeight = FontWeight.Bold,
                                color = Color(0xFF7E22CE)
                            )
                        }

                        // Element count badge
                        if (placed.isNotEmpty()) {
                            Box(
                                modifier = Modifier.align(Alignment.TopEnd)
                                    .padding(8.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(Color(0xD0FFFFFF))
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Text(
                                    "${placed.size} 个元素",
                                    fontSize = 9.sp, fontWeight = FontWeight.Bold,
                                    color = Color(0xFF7E22CE)
                                )
                            }
                        }

                        // Placed stickers
                        placed.forEach { p ->
                            Text(
                                p.emoji, fontSize = p.size.sp,
                                modifier = Modifier.align(Alignment.TopStart)
                                    .padding(
                                        start = (p.x / 100f * 200).dp,
                                        top = (p.y / 100f * 120).dp
                                    )
                                    .clickable {
                                        placed = placed.filter { it.id != p.id }
                                    }
                            )
                        }

                        // Empty hint
                        if (placed.isEmpty()) {
                            Text(
                                "从左边选人物或物品加入场景 ✨",
                                fontSize = 11.sp,
                                color = Color(0xFF7E22CE).copy(alpha = 0.45f),
                                modifier = Modifier.align(Alignment.Center)
                            )
                        }
                    }
                } else {
                    // No theme placeholder
                    Box(
                        modifier = Modifier.fillMaxWidth().weight(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(Color(0xFFFAF5FF))
                            .border(3.dp, Color(0x4DC084FC), RoundedCornerShape(16.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("✨", fontSize = 32.sp, color = Color(0xFFD8B4FE))
                            Text(
                                "选一个场景开始创作",
                                fontSize = 13.sp, fontWeight = FontWeight.Bold,
                                color = Color(0xFFC084FC)
                            )
                            Text(
                                "先从左边选一个场景主题 🎙️",
                                fontSize = 10.sp, color = Color(0xFFA78BBA)
                            )
                        }
                    }
                }

                // Bottom buttons
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    val enabled = themeSelected
                    val alpha = if (enabled) 1f else 0.4f
                    val disabledAlpha = 0.4f

                    // Save
                    val saveBg = if (saved) Color(0xFFDCFCE7) else Color(0xFFF3E8FF)
                    val saveFg = if (saved) Color(0xFF15803D) else Color(0xFF7E22CE)
                    Button(
                        onClick = { saved = true },
                        enabled = enabled,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = saveBg.copy(alpha = if (enabled) 1f else disabledAlpha),
                            disabledContainerColor = Color(0xFFF3E8FF).copy(alpha = disabledAlpha)
                        )
                    ) {
                        Text(
                            if (saved) "💾 已保存" else "💾 保存",
                            fontSize = 10.sp, fontWeight = FontWeight.Bold,
                            color = saveFg.copy(alpha = if (enabled) 1f else disabledAlpha)
                        )
                    }

                    // Print scene
                    val printSceneBg = if (printedScene) Color(0xFFDCFCE7) else Color(0xFFF3E8FF)
                    val printSceneFg = if (printedScene) Color(0xFF15803D) else Color(0xFF7E22CE)
                    Button(
                        onClick = { onPrint(st?.emoji ?: "", "${st?.label ?: ""} · 背景场景", "安静书"); printedScene = true },
                        enabled = enabled,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = printSceneBg.copy(alpha = if (enabled) 1f else disabledAlpha),
                            disabledContainerColor = Color(0xFFF3E8FF).copy(alpha = disabledAlpha)
                        )
                    ) {
                        Text(
                            "🖨️ 打印场景",
                            fontSize = 10.sp, fontWeight = FontWeight.Bold,
                            color = printSceneFg.copy(alpha = if (enabled) 1f else disabledAlpha)
                        )
                    }

                    // Print full
                    Button(
                        onClick = { onPrint(st?.emoji ?: "", "${st?.label ?: ""} · 完整画面", "安静书"); printedScene = true },
                        enabled = enabled,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFA855F7).copy(alpha = if (enabled) 1f else disabledAlpha),
                            disabledContainerColor = Color(0xFFE9D5FF).copy(alpha = disabledAlpha)
                        )
                    ) {
                        Text(
                            "🖨️ 打印全图",
                            fontSize = 10.sp, fontWeight = FontWeight.Bold,
                            color = Color.White.copy(alpha = if (enabled) 1f else disabledAlpha)
                        )
                    }
                }
            }
        }
    }
}
