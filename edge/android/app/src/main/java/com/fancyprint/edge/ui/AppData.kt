package com.fancyprint.edge.ui

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

enum class MainTab(val emoji: String, val label: String, val subtitle: String, val brush: Brush, val ring: Color) {
    VOICE("🎨", "涂鸦", "说出心愿，AI 画给你", Brush.linearGradient(listOf(Color(0xFFFBCFE8), Color(0xFFC084FC))), Color(0xFFD8B4FE)),
    SEARCH("✏️", "线稿", "挑一张喜欢的来涂色", Brush.linearGradient(listOf(Color(0xFFFDE68A), Color(0xFFFBCFE8))), Color(0xFFFCD34D)),
    BOOK("📖", "安静书", "生成专属故事书", Brush.linearGradient(listOf(Color(0xFFA7F3D0), Color(0xFFC4B5FD))), Color(0xFFA5B4FC)),
    WORKS("🖼️", "相册", "回看打印过的宝贝", Brush.linearGradient(listOf(Color(0xFFC4B5FD), Color(0xFFF9A8D4))), Color(0xFFF472B6)),
}

data class WorkItem(
    val id: String,
    val emoji: String,
    val desc: String,
    val type: String,
    val date: String,
    val starred: Boolean,
)

data class LineArtItem(val emoji: String, val name: String, val bg: Brush)
data class LineArtMode(val id: String, val label: String, val emoji: String)
data class QuietTheme(val id: String, val label: String, val emoji: String, val scene: String, val bg: Brush)
data class QuietSticker(val emoji: String, val name: String)
data class QuietPalette(val characters: List<QuietSticker>, val items: List<QuietSticker>)
data class PlacedSticker(val id: String, val emoji: String, val name: String, val x: Float, val y: Float, val size: Float)
data class VoicePoolItem(val emoji: String, val desc: String, val bg: Brush)

object AppData {
    val voicePrompts = listOf("戴帽子的小猫咪在草地玩耍", "彩虹独角兽在云朵跳舞", "小熊猫森林里喝下午茶")
    val voicePool = listOf(
        VoicePoolItem("🐱", "戴帽子的小猫咪", Brush.linearGradient(listOf(Color(0xFFFEF3C7), Color(0xFFFED7AA)))),
        VoicePoolItem("🦄", "彩虹独角兽", Brush.linearGradient(listOf(Color(0xFFFBCFE8), Color(0xFFDDD6FE)))),
        VoicePoolItem("🐼", "小熊猫下午茶", Brush.linearGradient(listOf(Color(0xFFD1FAE5), Color(0xFFA7F3D0)))),
        VoicePoolItem("🚀", "宇宙飞船冒险", Brush.linearGradient(listOf(Color(0xFFDBEAFE), Color(0xFFC7D2FE)))),
        VoicePoolItem("🐰", "魔法花园", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFFBCFE8)))),
        VoicePoolItem("🦊", "森林小狐狸", Brush.linearGradient(listOf(Color(0xFFFED7AA), Color(0xFFFECACA)))),
    )
    val lineModes = listOf(
        LineArtMode("outline", "纯线稿", "✏️"),
        LineArtMode("dots", "连点", "🔗"),
        LineArtMode("numbers", "数字", "🔢"),
        LineArtMode("letters", "字母", "🔤"),
    )
    val lineVoicePrompts = listOf("可爱的小恐龙", "美人鱼公主", "魔法独角兽", "森林精灵小屋")
    val lineCategories = listOf("动物", "植物", "交通", "食物", "城堡", "太空")
    val lineArtByCat: Map<String, List<LineArtItem>> = mapOf(
        "动物" to listOf(
            LineArtItem("🐘", "大象", Brush.linearGradient(listOf(Color(0xFFE0F2FE), Color(0xFFBAE6FD)))),
            LineArtItem("🦁", "狮子", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFFDE68A)))),
            LineArtItem("🐧", "企鹅", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFC7D2FE)))),
            LineArtItem("🦋", "蝴蝶", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFFBCFE8)))),
            LineArtItem("🐬", "海豚", Brush.linearGradient(listOf(Color(0xFFCFFAFE), Color(0xFFA5F3FC)))),
            LineArtItem("🦊", "狐狸", Brush.linearGradient(listOf(Color(0xFFFED7AA), Color(0xFFFECACA)))),
        ),
        "植物" to listOf(
            LineArtItem("🌸", "樱花", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFFBCFE8)))),
            LineArtItem("🌵", "仙人掌", Brush.linearGradient(listOf(Color(0xFFD1FAE5), Color(0xFFA7F3D0)))),
            LineArtItem("🌻", "向日葵", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFFDE68A)))),
            LineArtItem("🍄", "蘑菇", Brush.linearGradient(listOf(Color(0xFFFED7AA), Color(0xFFFECACA)))),
            LineArtItem("🌿", "嫩芽", Brush.linearGradient(listOf(Color(0xFFD1FAE5), Color(0xFFBBF7D0)))),
            LineArtItem("🌺", "木槿", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFDDD6FE)))),
        ),
        "交通" to listOf(
            LineArtItem("🚂", "小火车", Brush.linearGradient(listOf(Color(0xFFFEE2E2), Color(0xFFFECACA)))),
            LineArtItem("✈️", "飞机", Brush.linearGradient(listOf(Color(0xFFDBEAFE), Color(0xFFBFDBFE)))),
            LineArtItem("🚀", "火箭", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFDDD6FE)))),
            LineArtItem("🚢", "轮船", Brush.linearGradient(listOf(Color(0xFFCFFAFE), Color(0xFFA5F3FC)))),
            LineArtItem("🚁", "直升机", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFFDE68A)))),
            LineArtItem("🛸", "飞碟", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFC7D2FE)))),
        ),
        "食物" to listOf(
            LineArtItem("🍕", "披萨", Brush.linearGradient(listOf(Color(0xFFFED7AA), Color(0xFFFDE68A)))),
            LineArtItem("🍦", "冰淇淋", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFFBCFE8)))),
            LineArtItem("🎂", "蛋糕", Brush.linearGradient(listOf(Color(0xFFDDD6FE), Color(0xFFC4B5FD)))),
            LineArtItem("🍩", "甜甜圈", Brush.linearGradient(listOf(Color(0xFFFECACA), Color(0xFFFCA5A5)))),
            LineArtItem("🍓", "草莓", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFFBCFE8)))),
            LineArtItem("🧁", "纸杯蛋糕", Brush.linearGradient(listOf(Color(0xFFFCE7F3), Color(0xFFDDD6FE)))),
        ),
        "城堡" to listOf(
            LineArtItem("🏰", "魔法城堡", Brush.linearGradient(listOf(Color(0xFFDDD6FE), Color(0xFFC4B5FD)))),
            LineArtItem("🗼", "塔楼", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFC7D2FE)))),
            LineArtItem("⚔️", "骑士盾", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFFDE68A)))),
            LineArtItem("🔮", "水晶球", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFDDD6FE)))),
            LineArtItem("👑", "皇冠", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFFED7AA)))),
            LineArtItem("🧙", "巫师", Brush.linearGradient(listOf(Color(0xFFDDD6FE), Color(0xFFFBCFE8)))),
        ),
        "太空" to listOf(
            LineArtItem("🌙", "月亮", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFE0E7FF)))),
            LineArtItem("⭐", "星星", Brush.linearGradient(listOf(Color(0xFFFEF9C3), Color(0xFFFDE68A)))),
            LineArtItem("🪐", "土星", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFDDD6FE)))),
            LineArtItem("🌠", "流星", Brush.linearGradient(listOf(Color(0xFFDBEAFE), Color(0xFFDDD6FE)))),
            LineArtItem("👾", "外星人", Brush.linearGradient(listOf(Color(0xFFD1FAE5), Color(0xFFA7F3D0)))),
            LineArtItem("🔭", "望远镜", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFC7D2FE)))),
        ),
    )
    val quietThemes = listOf(
        QuietTheme("farm", "农场生活", "🌾", "🚜🌾🌳", Brush.linearGradient(listOf(Color(0xFFD1FAE5), Color(0xFFFEF3C7)))),
        QuietTheme("ocean", "海洋世界", "🌊", "🐚🌊🪸", Brush.linearGradient(listOf(Color(0xFFDBEAFE), Color(0xFFCFFAFE)))),
        QuietTheme("forest", "神秘森林", "🌲", "🌲🍄🌿", Brush.linearGradient(listOf(Color(0xFFD1FAE5), Color(0xFFBBF7D0)))),
        QuietTheme("space", "宇宙探险", "🚀", "🌌⭐🪐", Brush.linearGradient(listOf(Color(0xFFE0E7FF), Color(0xFFDDD6FE)))),
        QuietTheme("city", "城市冒险", "🏙️", "🏙️🚦🌳", Brush.linearGradient(listOf(Color(0xFFFED7AA), Color(0xFFFDE68A)))),
    )
    val quietPalette: Map<String, QuietPalette> = mapOf(
        "farm" to QuietPalette(
            characters = listOf(QuietSticker("👩‍🌾", "农场主"), QuietSticker("🧒", "小孩"), QuietSticker("🐄", "奶牛")),
            items = listOf(QuietSticker("🌽", "玉米"), QuietSticker("🍎", "苹果"), QuietSticker("🥕", "胡萝卜")),
        ),
        "ocean" to QuietPalette(
            characters = listOf(QuietSticker("🧜‍♀️", "美人鱼"), QuietSticker("🐠", "热带鱼"), QuietSticker("🐙", "章鱼")),
            items = listOf(QuietSticker("🐚", "贝壳"), QuietSticker("🪸", "珊瑚"), QuietSticker("⚓", "船锚")),
        ),
        "forest" to QuietPalette(
            characters = listOf(QuietSticker("🧚", "小精灵"), QuietSticker("🦊", "狐狸"), QuietSticker("🦔", "刺猬")),
            items = listOf(QuietSticker("🍄", "蘑菇"), QuietSticker("🌳", "大树"), QuietSticker("🍁", "枫叶")),
        ),
        "space" to QuietPalette(
            characters = listOf(QuietSticker("👨‍🚀", "宇航员"), QuietSticker("👽", "外星人"), QuietSticker("🤖", "机器人")),
            items = listOf(QuietSticker("⭐", "星星"), QuietSticker("🌙", "月亮"), QuietSticker("🚀", "火箭")),
        ),
        "city" to QuietPalette(
            characters = listOf(QuietSticker("👨‍🚒", "消防员"), QuietSticker("👮", "警察"), QuietSticker("🐕", "小狗")),
            items = listOf(QuietSticker("🚦", "红绿灯"), QuietSticker("🏠", "小屋"), QuietSticker("🍦", "冰淇淋")),
        ),
    )
    val voiceGenPairs = listOf(
        Triple("一只可爱的小熊", "🐻", "小熊"),
        Triple("穿裙子的公主", "👸", "公主"),
        Triple("彩虹独角兽", "🦄", "独角兽"),
    )
}
