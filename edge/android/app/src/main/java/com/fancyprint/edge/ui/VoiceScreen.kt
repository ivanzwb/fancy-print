package com.fancyprint.edge.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

data class GenImage(val emoji: String, val desc: String, val bg: Brush, val id: Long)

@Composable
fun VoiceScreen(onPrint: (emoji: String, desc: String, type: String) -> Unit) {
    var isListening by remember { mutableStateOf(false) }
    var transcript by remember { mutableStateOf("") }
    var generating by remember { mutableStateOf(false) }
    var images = remember { mutableStateListOf<GenImage>() }
    val savedIds = remember { mutableStateListOf<Long>() }
    val printedIds = remember { mutableStateListOf<Long>() }

    val generateImages: () -> Unit = {
        generating = true
        images.clear()
    }

    fun doGenerate() {
        val shuffled = AppData.voicePool.shuffled()
        val picks = shuffled.take(2).mapIndexed { idx, item ->
            GenImage(item.emoji, item.desc, item.bg, System.currentTimeMillis() + idx)
        }
        images.clear()
        images.addAll(picks)
        generating = false
    }

    LaunchedEffect(generating) {
        if (!generating) return@LaunchedEffect
        delay(1200)
        doGenerate()
    }

    LaunchedEffect(isListening) {
        if (!isListening) return@LaunchedEffect
        transcript = ""
        images.clear()
        savedIds.clear()
        printedIds.clear()
        val prompt = AppData.voicePrompts.random()
        prompt.forEachIndexed { i, _ ->
            delay(55)
            transcript = prompt.take(i + 1)
        }
        delay(400)
        isListening = false
        generateImages()
    }

    Column(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        // Header card
        val headerBg = Brush.linearGradient(listOf(Color(0xFFFDF4FF), Color(0xFFFCE7F3)))
        Box(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(headerBg)
                .border(2.dp, Color(0x4DC084FC), RoundedCornerShape(16.dp)).padding(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Mic button
                val infiniteTransition = rememberInfiniteTransition(label = "ping")
                val pingScale by infiniteTransition.animateFloat(
                    initialValue = 1f, targetValue = 1.25f,
                    animationSpec = infiniteRepeatable(tween(800, easing = LinearEasing), RepeatMode.Reverse),
                    label = "pingScale"
                )
                Box(
                    modifier = Modifier.size(56.dp).then(
                        if (isListening) Modifier.scale(pingScale) else Modifier
                    ).clip(CircleShape).background(
                        if (isListening) Brush.linearGradient(listOf(Color(0xFFF43F5E), Color(0xFFEC4899)))
                        else Brush.linearGradient(listOf(Color(0xFFA855F7), Color(0xFFC084FC)))
                    ).border(4.dp, Color.White, CircleShape).clickable(enabled = !generating) {
                        if (isListening) {
                            // Cannot stop mid-typing; let it finish
                        } else {
                            isListening = true
                        }
                    },
                    contentAlignment = Alignment.Center
                ) {
                    Text(if (isListening) "⏹" else "🎤", fontSize = 22.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("🎨 语音涂鸦", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
                    if (transcript.isNotEmpty()) {
                        Text("「${transcript}」${if (generating) "· AI 正在画..." else ""}",
                            fontSize = 12.sp, color = Color(0xFF3D2A5A), maxLines = 1)
                    } else {
                        Text(
                            when {
                                isListening -> "🎙️ 正在听你说话..."
                                generating -> "✨ AI 正在画两张图..."
                                images.isNotEmpty() -> "选一张喜欢的打印吧 ✨"
                                else -> "按下麦克风，说出你想画的内容 ✨"
                            },
                            fontSize = 11.sp, color = Color(0xFFA78BBA))
                    }
                }
                // Regenerate button (only when images are shown)
                AnimatedVisibility(visible = !generating && images.isNotEmpty(), enter = fadeIn()) {
                    TextButton(
                        onClick = { generateImages() },
                        colors = ButtonDefaults.textButtonColors(contentColor = Color(0xFF7E22CE)),
                        modifier = Modifier.border(2.dp, Color(0xFFC084FC), RoundedCornerShape(999.dp))
                    ) {
                        Text("✨ 再画", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        Spacer(Modifier.height(16.dp))

        // Loading / empty / image display area
        Box(
            modifier = Modifier.fillMaxWidth()
                .clip(RoundedCornerShape(20.dp)).background(Color(0xFFFDF4FF))
                .border(2.dp, Color(0x33C084FC), RoundedCornerShape(20.dp)).padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            when {
                generating -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("⏳", fontSize = 36.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("AI 同时创作两个版本...", fontSize = 13.sp, color = Color(0xFF7C6A90))
                        Spacer(Modifier.height(12.dp))
                        LinearProgressIndicator(Modifier.fillMaxWidth(0.6f), color = Color(0xFFA855F7), trackColor = Color(0x33C084FC))
                    }
                }
                images.isEmpty() -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("✨", fontSize = 36.sp)
                        Spacer(Modifier.height(8.dp))
                        Text("说出你的想法，AI 一次画两张哦 🎨", fontSize = 13.sp, color = Color(0xFFA78BBA))
                    }
                }
                else -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        images.forEachIndexed { idx, img ->
                            Column(
                                modifier = Modifier.weight(1f),
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                // Image card
                                Box(
                                    modifier = Modifier.fillMaxWidth().aspectRatio(210f / 148f)
                                        .clip(RoundedCornerShape(16.dp)).background(img.bg)
                                        .border(3.dp, Color(0x4DC084FC), RoundedCornerShape(16.dp)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text("版本 ${idx + 1}", fontSize = 9.sp, fontWeight = FontWeight.Bold,
                                        color = Color(0xFF7E22CE),
                                        modifier = Modifier.align(Alignment.TopStart)
                                            .background(Color(0xBFFFFFFF), RoundedCornerShape(999.dp))
                                            .padding(horizontal = 8.dp, vertical = 2.dp))
                                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                        Text(img.emoji, fontSize = 56.sp)
                                        Text(img.desc, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                                            color = Color(0xFF5B21B6))
                                    }
                                }
                                Spacer(Modifier.height(8.dp))
                                // Action buttons
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    // Save button
                                    val isSaved = img.id in savedIds
                                    Box(
                                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp))
                                            .background(if (isSaved) Color(0xFFDCFCE7) else Color(0xFFF3E8FF))
                                            .clickable { if (img.id !in savedIds) savedIds.add(img.id) }
                                            .padding(vertical = 6.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(if (isSaved) "✅ 已保存" else "💾 保存",
                                            fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                            color = if (isSaved) Color(0xFF15803D) else Color(0xFF7E22CE))
                                    }
                                    // Print button
                                    val isPrinted = img.id in printedIds
                                    Box(
                                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp))
                                            .then(
                                                if (isPrinted) Modifier.background(Color(0xFFDCFCE7))
                                                else Modifier.background(Brush.linearGradient(listOf(Color(0xFFA855F7), Color(0xFFEC4899))))
                                            )
                                            .clickable(enabled = !isPrinted) {
                                                printedIds.add(img.id)
                                                onPrint(img.emoji, img.desc, "涂鸦")
                                            }
                                            .padding(vertical = 6.dp),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(if (isPrinted) "✅ 已打印" else "🖨️ 打印",
                                            fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                            color = if (isPrinted) Color(0xFF15803D) else Color.White)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
