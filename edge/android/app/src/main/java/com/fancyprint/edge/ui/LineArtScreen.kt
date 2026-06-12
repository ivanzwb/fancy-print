package com.fancyprint.edge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun LineArtScreen(onPrint: (emoji: String, desc: String, type: String) -> Unit) {
    var cat by remember { mutableStateOf(AppData.lineCategories.first()) }
    var search by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("outline") }
    var preview by remember { mutableStateOf<LineArtItem?>(null) }
    var saved by remember { mutableStateOf(false) }
    var printed by remember { mutableStateOf(false) }

    val allItems = AppData.lineArtByCat.values.flatten()
    val filtered = if (search.isNotBlank()) allItems.filter { it.name.contains(search) }
                   else AppData.lineArtByCat[cat].orEmpty()

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // ── Top mic bar ──
        Row(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                .background(Color(0xFFFDF4FF))
                .border(2.dp, Color(0x4DC084FC), RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier.size(48.dp)
                    .clip(RoundedCornerShape(50))
                    .background(Color(0xFFA855F7), RoundedCornerShape(50)),
                contentAlignment = Alignment.Center
            ) {
                Text("🎤", fontSize = 18.sp)
            }
            Column(modifier = Modifier.weight(1f)) {
                Text("✏️ 语音生成线稿", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
                Text("说出你想要的线稿，或从下方挑选模板", fontSize = 12.sp, color = Color(0xFFA78BBA))
            }
        }

        // ── Body: left/right split (fills remaining space) ──
        Row(
            modifier = Modifier.fillMaxWidth().weight(1f),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // ── Left: search + categories + grid ──
            Column(
                modifier = Modifier.weight(0.44f).fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Search bar
                Row(
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFFF3E8FF))
                        .border(2.dp, Color(0x33C084FC), RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("🔍", fontSize = 13.sp)
                    BasicTextField(
                        value = search,
                        onValueChange = { search = it; preview = null; saved = false; printed = false },
                        singleLine = true,
                        textStyle = androidx.compose.ui.text.TextStyle(
                            fontSize = 12.sp,
                            color = Color(0xFF3D2A5A)
                        ),
                        cursorBrush = SolidColor(Color(0xFFA855F7)),
                        modifier = Modifier.weight(1f),
                        decorationBox = { innerTextField ->
                            Box {
                                if (search.isEmpty()) Text("搜索线稿模板...", fontSize = 12.sp, color = Color(0xFFA78BBA))
                                innerTextField()
                            }
                        }
                    )
                }

                // Category pills (only when not searching)
                if (search.isBlank()) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(AppData.lineCategories) { c ->
                            val active = c == cat
                            Text(
                                c,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(if (active) Color(0xFFA855F7) else Color(0xFFF3E8FF))
                                    .clickable { cat = c; preview = null; saved = false; printed = false }
                                    .padding(horizontal = 12.dp, vertical = 6.dp),
                                color = if (active) Color.White else Color(0xFF7C6A90),
                                fontWeight = FontWeight.Bold,
                                fontSize = 11.sp,
                            )
                        }
                    }
                }

                // Items grid (2 columns, fills remaining space)
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filtered, key = { it.name }) { item ->
                        val on = preview?.name == item.name
                        Column(
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (on) Color(0xFFFBCFE8) else Color.White)
                                .border(
                                    2.dp,
                                    if (on) Color(0xFFC084FC) else Color(0x26C084FC),
                                    RoundedCornerShape(12.dp)
                                )
                                .clickable { preview = item; saved = false; printed = false }
                                .padding(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Box(
                                modifier = Modifier.fillMaxWidth()
                                    .aspectRatio(210f / 148f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(item.bg),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(item.emoji, fontSize = 34.sp)
                            }
                            Text(item.name, fontSize = 10.sp, color = Color(0xFF7C6A90), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // ── Right: mode + preview + buttons ──
            Column(
                modifier = Modifier.weight(0.56f).fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Mode selector
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    AppData.lineModes.forEach { m ->
                        val active = mode == m.id
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(12.dp))
                                .background(
                                    if (active) Color(0xFFA855F7) else Color(0xFFF3E8FF),
                                    RoundedCornerShape(12.dp)
                                )
                                .clickable { mode = m.id }
                                .padding(vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(m.emoji, fontSize = 14.sp)
                            Text(
                                m.label, fontSize = 10.sp, fontWeight = FontWeight.Bold,
                                color = if (active) Color.White else Color(0xFF7C6A90)
                            )
                        }
                    }
                }

                // Preview area (fills remaining space)
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f)
                        .clip(RoundedCornerShape(16.dp))
                        .then(
                            if (preview != null) Modifier.background(preview!!.bg)
                            else Modifier
                        )
                        .then(
                            if (preview != null) Modifier.border(3.dp, Color(0x59C084FC), RoundedCornerShape(16.dp))
                            else Modifier
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (preview != null) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(preview!!.emoji, fontSize = 56.sp, modifier = Modifier.padding(top = 8.dp))
                            Text(preview!!.name, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color(0xFF5B21B6))
                        }
                        // Mode badge (top-right)
                        val curMode = AppData.lineModes.find { it.id == mode }
                        if (curMode != null) {
                            Box(
                                modifier = Modifier.align(Alignment.TopEnd)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(Color(0xE0FFFFFF))
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Text("${curMode.emoji} ${curMode.label}", fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
                            }
                        }
                    } else {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text("✨", fontSize = 30.sp)
                            Text("语音生成 或 从左边挑模板", fontSize = 12.sp, color = Color(0xFFA78BBA))
                        }
                    }
                }

                // Save + Print buttons
                if (preview != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Save
                        val saveLabel = if (saved) "已保存" else "保存"
                        val saveBg = if (saved) Color(0xFFDCFCE7) else Color(0xFFF3E8FF)
                        val saveFg = if (saved) Color(0xFF15803D) else Color(0xFF7E22CE)
                        Button(
                            onClick = { saved = true },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = saveBg)
                        ) {
                            Text("💾  $saveLabel", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = saveFg)
                        }

                        // Print
                        val printLabel = if (printed) "已打印" else "打印"
                        val printBg = if (printed) Color(0xFFDCFCE7) else Color(0xFFF59E0B)
                        val printFg = if (printed) Color(0xFF15803D) else Color.White
                        Button(
                            onClick = {
                                val p = preview ?: return@Button
                                val curMode = AppData.lineModes.find { it.id == mode } ?: return@Button
                                onPrint(p.emoji, "${p.name} · ${curMode.label}", "线稿")
                                printed = true
                            },
                            enabled = !printed,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = printBg)
                        ) {
                            Text("🖨️  $printLabel", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = printFg)
                        }
                    }
                }
            }
        }
    }
}
