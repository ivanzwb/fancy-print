package com.fancyprint.edge.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun WorksScreen(
    works: List<WorkItem>,
    onDelete: (id: String) -> Unit,
    onToggle: (id: String) -> Unit,
    onPrintAgain: (WorkItem) -> Unit,
) {
    if (works.isEmpty()) {
        Column(modifier = Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text("🖼️", fontSize = 48.sp)
            Spacer(Modifier.height(12.dp))
            Text("还没有作品哦", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color(0xFF7E22CE))
            Text("去涂鸦、线稿或安静书里打印第一张吧～", fontSize = 12.sp, color = Color(0xFFA78BBA))
        }
        return
    }
    LazyColumn(modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(works, key = { it.id }) { w ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), border = androidx.compose.foundation.BorderStroke(1.dp, Color(0x33C084FC))) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(w.emoji, fontSize = 40.sp, modifier = Modifier.padding(end = 10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(w.desc, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = Color(0xFF5B21B6), maxLines = 2)
                        Text("${w.type} · ${w.date}", fontSize = 11.sp, color = Color(0xFFA78BBA))
                    }
                    IconButton(onClick = { onToggle(w.id) }) {
                        Icon(if (w.starred) Icons.Default.Star else Icons.Outlined.StarBorder, contentDescription = null, tint = if (w.starred) Color(0xFFF59E0B) else Color(0xFFA78BBA))
                    }
                    IconButton(onClick = { onPrintAgain(w) }) {
                        Icon(Icons.Default.Print, null, tint = Color(0xFFA855F7))
                    }
                    IconButton(onClick = { onDelete(w.id) }) {
                        Icon(Icons.Default.Delete, null, tint = Color(0xFFF43F5E))
                    }
                }
            }
        }
    }
}
