// en-US (英语)
// de-DE (德语)
// es-ES (西班牙语)
// hi-IN (印地语)
// ja-JP (日语)
// ko-KR (韩语)
// pt-BR (葡萄牙语)
// ru-RU (俄语)
// zh-CN (简体中文)
// zh-TW (繁体中文)
// id-ID (印尼语)
// fr-FR (法语)
// it-IT (意大利语)
// pl-PL (波兰语)
// vi-VN (越南语)
// tr-TR (土耳其语)
// th-TH (泰语)

export const locales = [
  "zh-CN",
  "en-US",
  "zh-TW",
  "ja-JP",
  "ko-KR",
  "pt-BR",
  "ru-RU",
  "id-ID",
  "fr-FR",
  "it-IT",
  "pl-PL",
  "vi-VN",
  "tr-TR",
  "th-TH",
  "de-DE",
  "es-ES",
  "hi-IN",
] as const;

export type Locale = (typeof locales)[number];

/**
 * 验证给定的字符串是否为有效的语言代码
 * @param locale - 要验证的语言代码
 * @returns 如果是有效的语言代码返回 true，否则返回 false
 */
export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

/**
 * 语言配置类型，用于 LLM 生成标签树
 */
export type LanguageConfig = {
  schemaName: string;
  schemaDescription: string;
  promptIntro: string;
  level1Label: string;
  level2Label: string;
  level3Label1: string;
  level3Label2: string;
  level4Label: string;
  notes: string;
};

/**
 * 语言配置映射，用于 generateTagTreeByLLM
 */
export const languageConfigMap: Record<Locale, LanguageConfig> = {
  "zh-CN": {
    schemaName: "TagTree",
    schemaDescription: "企业数字资产的标签分类体系（最多四层）",
    promptIntro: "请以 JSON 格式返回标签树，结构如下：",
    level1Label: "一级标签名称",
    level2Label: "二级标签名称",
    level3Label1: "三级标签名称1",
    level3Label2: "三级标签名称2",
    level4Label: "四级标签名称",
    notes: `注意：
- 标签名称应简洁、专业、互斥
- children 为可选字段，没有子标签时可以省略
- 标签层级最多四层：一般为三层，确有需要细分时可为三级标签添加四级子标签
- 确保所有标签名称都是有意义的中文文本`,
  },
  "en-US": {
    schemaName: "TagTree",
    schemaDescription:
      "Tag classification system for enterprise digital assets (up to four tiers)",
    promptIntro: "Please return the tag tree in JSON format with the following structure:",
    level1Label: "Level 1 Tag Name",
    level2Label: "Level 2 Tag Name",
    level3Label1: "Level 3 Tag Name 1",
    level3Label2: "Level 3 Tag Name 2",
    level4Label: "Level 4 Tag Name",
    notes: `Notes:
- Tag names should be concise, professional, and mutually exclusive
- children field is optional, omit if there are no sub-tags
- The tag tree has at most four levels: usually three, add level-4 children under a level-3 tag only when finer granularity is truly needed
- Ensure all tag names are meaningful English text`,
  },
  "zh-TW": {
    schemaName: "TagTree",
    schemaDescription: "企業數位資產的標籤分類體系（最多四層）",
    promptIntro: "請以 JSON 格式返回標籤樹，結構如下：",
    level1Label: "一級標籤名稱",
    level2Label: "二級標籤名稱",
    level3Label1: "三級標籤名稱1",
    level3Label2: "三級標籤名稱2",
    level4Label: "四級標籤名稱",
    notes: `注意：
- 標籤名稱應簡潔、專業、互斥
- children 為可選欄位，沒有子標籤時可以省略
- 標籤層級最多四層：一般為三層，確有需要細分時可為三級標籤新增四級子標籤
- 確保所有標籤名稱都是有意義的繁體中文（台灣）文本`,
  },
  "ja-JP": {
    schemaName: "TagTree",
    schemaDescription: "企業デジタル資産のタグ分類システム（最大4階層）",
    promptIntro: "以下の構造でJSON形式でタグツリーを返してください：",
    level1Label: "レベル1タグ名",
    level2Label: "レベル2タグ名",
    level3Label1: "レベル3タグ名1",
    level3Label2: "レベル3タグ名2",
    level4Label: "レベル4タグ名",
    notes: `注意事項：
- タグ名は簡潔で、専門的で、相互排他的である必要があります
- childrenフィールドはオプションで、サブタグがない場合は省略できます
- タグの階層は最大4階層です：通常は3階層とし、さらに細分化が必要な場合のみレベル3タグの下にレベル4タグを追加してください
- すべてのタグ名が意味のある日本語テキストであることを確認してください`,
  },
  "ko-KR": {
    schemaName: "TagTree",
    schemaDescription: "기업 디지털 자산의 태그 분류 시스템(최대 4단계)",
    promptIntro: "다음 구조로 JSON 형식의 태그 트리를 반환하세요:",
    level1Label: "1단계 태그 이름",
    level2Label: "2단계 태그 이름",
    level3Label1: "3단계 태그 이름1",
    level3Label2: "3단계 태그 이름2",
    level4Label: "4단계 태그 이름",
    notes: `참고사항:
- 태그 이름은 간결하고 전문적이며 상호 배타적이어야 합니다
- children 필드는 선택 사항이며 하위 태그가 없으면 생략할 수 있습니다
- 태그 계층은 최대 4단계입니다: 보통 3단계로 구성하고, 더 세분화가 필요한 경우에만 3단계 태그 아래에 4단계 태그를 추가하세요
- 모든 태그 이름이 의미 있는 한국어 텍스트인지 확인하세요`,
  },
  "pt-BR": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistema de classificação de tags para ativos digitais empresariais (até quatro níveis)",
    promptIntro: "Retorne a árvore de tags em formato JSON com a seguinte estrutura:",
    level1Label: "Nome da Tag Nível 1",
    level2Label: "Nome da Tag Nível 2",
    level3Label1: "Nome da Tag Nível 3-1",
    level3Label2: "Nome da Tag Nível 3-2",
    level4Label: "Nome da Tag Nível 4",
    notes: `Observações:
- Os nomes das tags devem ser concisos, profissionais e mutuamente exclusivos
- O campo children é opcional, omita se não houver sub-tags
- A árvore de tags tem no máximo quatro níveis: normalmente três; adicione tags de nível 4 sob uma tag de nível 3 somente quando for realmente necessário detalhar mais
- Certifique-se de que todos os nomes das tags sejam textos em português significativos`,
  },
  "ru-RU": {
    schemaName: "TagTree",
    schemaDescription:
      "Система классификации тегов для корпоративных цифровых активов (до четырёх уровней)",
    promptIntro: "Верните дерево тегов в формате JSON со следующей структурой:",
    level1Label: "Название тега уровня 1",
    level2Label: "Название тега уровня 2",
    level3Label1: "Название тега уровня 3-1",
    level3Label2: "Название тега уровня 3-2",
    level4Label: "Название тега уровня 4",
    notes: `Примечания:
- Названия тегов должны быть краткими, профессиональными и взаимоисключающими
- Поле children является необязательным, пропустите его, если нет подтегов
- Дерево тегов содержит не более четырёх уровней: обычно три; добавляйте теги уровня 4 под тегом уровня 3 только при реальной необходимости более детальной классификации
- Убедитесь, что все названия тегов являются осмысленными русскими текстами`,
  },
  "id-ID": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistem klasifikasi tag untuk aset digital perusahaan (hingga empat tingkat)",
    promptIntro: "Kembalikan pohon tag dalam format JSON dengan struktur berikut:",
    level1Label: "Nama Tag Level 1",
    level2Label: "Nama Tag Level 2",
    level3Label1: "Nama Tag Level 3-1",
    level3Label2: "Nama Tag Level 3-2",
    level4Label: "Nama Tag Level 4",
    notes: `Catatan:
- Nama tag harus ringkas, profesional, dan saling eksklusif
- Field children bersifat opsional, abaikan jika tidak ada sub-tag
- Pohon tag memiliki maksimal empat tingkat: biasanya tiga; tambahkan tag level 4 di bawah tag level 3 hanya jika benar-benar perlu klasifikasi yang lebih rinci
- Pastikan semua nama tag adalah teks bahasa Indonesia yang bermakna`,
  },
  "fr-FR": {
    schemaName: "TagTree",
    schemaDescription:
      "Système de classification de tags pour les actifs numériques d'entreprise (jusqu'à quatre niveaux)",
    promptIntro:
      "Veuillez renvoyer l'arborescence de tags au format JSON avec la structure suivante:",
    level1Label: "Nom du tag niveau 1",
    level2Label: "Nom du tag niveau 2",
    level3Label1: "Nom du tag niveau 3-1",
    level3Label2: "Nom du tag niveau 3-2",
    level4Label: "Nom du tag niveau 4",
    notes: `Remarques:
- Les noms de tags doivent être concis, professionnels et mutuellement exclusifs
- Le champ children est optionnel, omettre s'il n'y a pas de sous-tags
- L'arborescence comporte au maximum quatre niveaux : généralement trois ; n'ajoutez des tags de niveau 4 sous un tag de niveau 3 que si une granularité plus fine est vraiment nécessaire
- Assurez-vous que tous les noms de tags sont des textes français significatifs`,
  },
  "it-IT": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistema di classificazione tag per risorse digitali aziendali (fino a quattro livelli)",
    promptIntro: "Restituisci l'albero dei tag in formato JSON con la seguente struttura:",
    level1Label: "Nome tag livello 1",
    level2Label: "Nome tag livello 2",
    level3Label1: "Nome tag livello 3-1",
    level3Label2: "Nome tag livello 3-2",
    level4Label: "Nome tag livello 4",
    notes: `Note:
- I nomi dei tag devono essere concisi, professionali e mutualmente esclusivi
- Il campo children è opzionale, omettere se non ci sono sotto-tag
- L'albero dei tag ha al massimo quattro livelli: di solito tre; aggiungere tag di livello 4 sotto un tag di livello 3 solo se è davvero necessaria una suddivisione più fine
- Assicurarsi che tutti i nomi dei tag siano testi italiani significativi`,
  },
  "pl-PL": {
    schemaName: "TagTree",
    schemaDescription:
      "System klasyfikacji tagów dla cyfrowych zasobów przedsiębiorstwa (do czterech poziomów)",
    promptIntro: "Zwróć drzewo tagów w formacie JSON z następującą strukturą:",
    level1Label: "Nazwa tagu poziomu 1",
    level2Label: "Nazwa tagu poziomu 2",
    level3Label1: "Nazwa tagu poziomu 3-1",
    level3Label2: "Nazwa tagu poziomu 3-2",
    level4Label: "Nazwa tagu poziomu 4",
    notes: `Uwagi:
- Nazwy tagów powinny być zwięzłe, profesjonalne i wzajemnie wykluczające się
- Pole children jest opcjonalne, pomiń je, jeśli nie ma pod-tagów
- Drzewo tagów ma maksymalnie cztery poziomy: zwykle trzy; dodawaj tagi poziomu 4 pod tagiem poziomu 3 tylko wtedy, gdy naprawdę potrzebny jest dokładniejszy podział
- Upewnij się, że wszystkie nazwy tagów są znaczącymi polskimi tekstami`,
  },
  "vi-VN": {
    schemaName: "TagTree",
    schemaDescription:
      "Hệ thống phân loại thẻ cho tài sản kỹ thuật số doanh nghiệp (tối đa bốn cấp)",
    promptIntro: "Vui lòng trả về cây thẻ ở định dạng JSON với cấu trúc sau:",
    level1Label: "Tên thẻ cấp 1",
    level2Label: "Tên thẻ cấp 2",
    level3Label1: "Tên thẻ cấp 3-1",
    level3Label2: "Tên thẻ cấp 3-2",
    level4Label: "Tên thẻ cấp 4",
    notes: `Lưu ý:
- Tên thẻ phải ngắn gọn, chuyên nghiệp và loại trừ lẫn nhau
- Trường children là tùy chọn, bỏ qua nếu không có thẻ con
- Cây thẻ có tối đa bốn cấp: thường là ba cấp; chỉ thêm thẻ cấp 4 dưới thẻ cấp 3 khi thực sự cần phân loại chi tiết hơn
- Đảm bảo tất cả tên thẻ đều là văn bản tiếng Việt có ý nghĩa`,
  },
  "tr-TR": {
    schemaName: "TagTree",
    schemaDescription:
      "Kurumsal dijital varlıklar için etiket sınıflandırma sistemi (en fazla dört seviye)",
    promptIntro: "Lütfen aşağıdaki yapıyla JSON formatında etiket ağacını döndürün:",
    level1Label: "Seviye 1 Etiket Adı",
    level2Label: "Seviye 2 Etiket Adı",
    level3Label1: "Seviye 3 Etiket Adı-1",
    level3Label2: "Seviye 3 Etiket Adı-2",
    level4Label: "Seviye 4 Etiket Adı",
    notes: `Notlar:
- Etiket adları kısa, profesyonel ve birbirini dışlayıcı olmalıdır
- children alanı isteğe bağlıdır, alt etiket yoksa atlayın
- Etiket ağacı en fazla dört seviyelidir: genellikle üç seviye; yalnızca daha ayrıntılı sınıflandırma gerçekten gerekiyorsa seviye 3 etiketin altına seviye 4 etiketler ekleyin
- Tüm etiket adlarının anlamlı Türkçe metinler olduğundan emin olun`,
  },
  "th-TH": {
    schemaName: "TagTree",
    schemaDescription: "ระบบจำแนกแท็กสำหรับสินทรัพย์ดิจิทัลขององค์กร (สูงสุดสี่ระดับ)",
    promptIntro: "กรุณาส่งคืนต้นไม้แท็กในรูปแบบ JSON ด้วยโครงสร้างต่อไปนี้:",
    level1Label: "ชื่อแท็กระดับ 1",
    level2Label: "ชื่อแท็กระดับ 2",
    level3Label1: "ชื่อแท็กระดับ 3-1",
    level3Label2: "ชื่อแท็กระดับ 3-2",
    level4Label: "ชื่อแท็กระดับ 4",
    notes: `หมายเหตุ:
- ชื่อแท็กควรกระชับ เป็นมืออาชีพ และไม่ซ้ำกัน
- ฟิลด์ children เป็นทางเลือก ข้ามได้หากไม่มีแท็กย่อย
- ต้นไม้แท็กมีได้สูงสุดสี่ระดับ: โดยทั่วไปใช้สามระดับ ให้เพิ่มแท็กระดับ 4 ใต้แท็กระดับ 3 เฉพาะเมื่อจำเป็นต้องแบ่งย่อยละเอียดขึ้นจริงๆ
- ตรวจสอบให้แน่ใจว่าชื่อแท็กทั้งหมดเป็นข้อความภาษาไทยที่มีความหมาย`,
  },
  "de-DE": {
    schemaName: "TagTree",
    schemaDescription:
      "Tag-Klassifizierungssystem für Unternehmens-Digitalassets (bis zu vier Ebenen)",
    promptIntro: "Bitte geben Sie den Tag-Baum im JSON-Format mit folgender Struktur zurück:",
    level1Label: "Tag-Name Ebene 1",
    level2Label: "Tag-Name Ebene 2",
    level3Label1: "Tag-Name Ebene 3-1",
    level3Label2: "Tag-Name Ebene 3-2",
    level4Label: "Tag-Name Ebene 4",
    notes: `Hinweise:
- Tag-Namen sollten prägnant, professionell und sich gegenseitig ausschließend sein
- Das Feld children ist optional, lassen Sie es weg, wenn es keine Unter-Tags gibt
- Der Tag-Baum hat höchstens vier Ebenen: in der Regel drei; fügen Sie Tags der Ebene 4 unter einem Tag der Ebene 3 nur hinzu, wenn eine feinere Unterteilung wirklich nötig ist
- Stellen Sie sicher, dass alle Tag-Namen aussagekräftige deutsche Texte sind`,
  },
  "es-ES": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistema de clasificación de etiquetas para activos digitales empresariales (hasta cuatro niveles)",
    promptIntro:
      "Por favor, devuelva el árbol de etiquetas en formato JSON con la siguiente estructura:",
    level1Label: "Nombre de etiqueta nivel 1",
    level2Label: "Nombre de etiqueta nivel 2",
    level3Label1: "Nombre de etiqueta nivel 3-1",
    level3Label2: "Nombre de etiqueta nivel 3-2",
    level4Label: "Nombre de etiqueta nivel 4",
    notes: `Notas:
- Los nombres de las etiquetas deben ser concisos, profesionales y mutuamente excluyentes
- El campo children es opcional, omítalo si no hay sub-etiquetas
- El árbol de etiquetas tiene como máximo cuatro niveles: normalmente tres; añada etiquetas de nivel 4 bajo una etiqueta de nivel 3 solo cuando realmente se necesite una clasificación más detallada
- Asegúrese de que todos los nombres de etiquetas sean textos en español significativos`,
  },
  "hi-IN": {
    schemaName: "TagTree",
    schemaDescription: "उद्यम डिजिटल संपत्तियों के लिए टैग वर्गीकरण प्रणाली (अधिकतम चार स्तर)",
    promptIntro: "कृपया निम्नलिखित संरचना के साथ JSON प्रारूप में टैग ट्री लौटाएं:",
    level1Label: "स्तर 1 टैग नाम",
    level2Label: "स्तर 2 टैग नाम",
    level3Label1: "स्तर 3 टैग नाम-1",
    level3Label2: "स्तर 3 टैग नाम-2",
    level4Label: "स्तर 4 टैग नाम",
    notes: `नोट्स:
- टैग नाम संक्षिप्त, पेशेवर और परस्पर अनन्य होने चाहिए
- children फ़ील्ड वैकल्पिक है, यदि कोई उप-टैग नहीं हैं तो इसे छोड़ दें
- टैग ट्री में अधिकतम चार स्तर होते हैं: आमतौर पर तीन; स्तर 3 टैग के नीचे स्तर 4 टैग केवल तभी जोड़ें जब वास्तव में अधिक विस्तृत वर्गीकरण की आवश्यकता हो
- सुनिश्चित करें कि सभी टैग नाम सार्थक हिंदी पाठ हैं`,
  },
};

/**
 * 获取指定语言的语言配置，如果不存在则返回中文配置
 * @param locale - 语言代码
 * @returns 语言配置对象
 */
export function getLanguageConfig(locale: Locale): LanguageConfig {
  return languageConfigMap[locale] || languageConfigMap["zh-CN"];
}
