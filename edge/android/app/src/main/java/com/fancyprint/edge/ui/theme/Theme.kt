package com.fancyprint.edge.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Purple = Color(0xFFA855F7)
private val Pink = Color(0xFFEC4899)

private val Light = lightColorScheme(
    primary = Purple,
    secondary = Pink,
    tertiary = Color(0xFFFBCFE8),
    background = Color(0xFFFEF6FF),
    surface = Color(0xFFFFFFFF),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFD8B4FE),
    secondary = Color(0xFFF9A8D4),
    background = Color(0xFF1A1025),
    surface = Color(0xFF2D1F3D),
)

@Composable
fun QixiangPrintTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}
