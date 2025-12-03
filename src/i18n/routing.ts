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
  notes: string;
};

/**
 * 语言配置映射，用于 generateTagTreeByLLM
 */
export const languageConfigMap: Record<Locale, LanguageConfig> = {
  "zh-CN": {
    schemaName: "TagTree",
    schemaDescription: "企业数字资产的三层标签分类体系",
    promptIntro: "请以 JSON 格式返回标签树，结构如下：",
    level1Label: "一级标签名称",
    level2Label: "二级标签名称",
    level3Label1: "三级标签名称1",
    level3Label2: "三级标签名称2",
    notes: `注意：
- 标签名称应简洁、专业、互斥
- children 为可选字段，没有子标签时可以省略
- 确保所有标签名称都是有意义的中文文本`,
  },
  "en-US": {
    schemaName: "TagTree",
    schemaDescription: "Three-tier tag classification system for enterprise digital assets",
    promptIntro: "Please return the tag tree in JSON format with the following structure:",
    level1Label: "Level 1 Tag Name",
    level2Label: "Level 2 Tag Name",
    level3Label1: "Level 3 Tag Name 1",
    level3Label2: "Level 3 Tag Name 2",
    notes: `Notes:
- Tag names should be concise, professional, and mutually exclusive
- children field is optional, omit if there are no sub-tags
- Ensure all tag names are meaningful English text`,
  },
  "zh-TW": {
    schemaName: "TagTree",
    schemaDescription: "企業數位資產的三層標籤分類體系",
    promptIntro: "請以 JSON 格式返回標籤樹，結構如下：",
    level1Label: "一級標籤名稱",
    level2Label: "二級標籤名稱",
    level3Label1: "三級標籤名稱1",
    level3Label2: "三級標籤名稱2",
    notes: `注意：
- 標籤名稱應簡潔、專業、互斥
- children 為可選欄位，沒有子標籤時可以省略
- 確保所有標籤名稱都是有意義的繁體中文（台灣）文本`,
  },
  "ja-JP": {
    schemaName: "TagTree",
    schemaDescription: "企業デジタル資産の3層タグ分類システム",
    promptIntro: "以下の構造でJSON形式でタグツリーを返してください：",
    level1Label: "レベル1タグ名",
    level2Label: "レベル2タグ名",
    level3Label1: "レベル3タグ名1",
    level3Label2: "レベル3タグ名2",
    notes: `注意事項：
- タグ名は簡潔で、専門的で、相互排他的である必要があります
- childrenフィールドはオプションで、サブタグがない場合は省略できます
- すべてのタグ名が意味のある日本語テキストであることを確認してください`,
  },
  "ko-KR": {
    schemaName: "TagTree",
    schemaDescription: "기업 디지털 자산의 3단계 태그 분류 시스템",
    promptIntro: "다음 구조로 JSON 형식의 태그 트리를 반환하세요:",
    level1Label: "1단계 태그 이름",
    level2Label: "2단계 태그 이름",
    level3Label1: "3단계 태그 이름1",
    level3Label2: "3단계 태그 이름2",
    notes: `참고사항:
- 태그 이름은 간결하고 전문적이며 상호 배타적이어야 합니다
- children 필드는 선택 사항이며 하위 태그가 없으면 생략할 수 있습니다
- 모든 태그 이름이 의미 있는 한국어 텍스트인지 확인하세요`,
  },
  "pt-BR": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistema de classificação de tags de três níveis para ativos digitais empresariais",
    promptIntro: "Retorne a árvore de tags em formato JSON com a seguinte estrutura:",
    level1Label: "Nome da Tag Nível 1",
    level2Label: "Nome da Tag Nível 2",
    level3Label1: "Nome da Tag Nível 3-1",
    level3Label2: "Nome da Tag Nível 3-2",
    notes: `Observações:
- Os nomes das tags devem ser concisos, profissionais e mutuamente exclusivos
- O campo children é opcional, omita se não houver sub-tags
- Certifique-se de que todos os nomes das tags sejam textos em português significativos`,
  },
  "ru-RU": {
    schemaName: "TagTree",
    schemaDescription:
      "Трехуровневая система классификации тегов для корпоративных цифровых активов",
    promptIntro: "Верните дерево тегов в формате JSON со следующей структурой:",
    level1Label: "Название тега уровня 1",
    level2Label: "Название тега уровня 2",
    level3Label1: "Название тега уровня 3-1",
    level3Label2: "Название тега уровня 3-2",
    notes: `Примечания:
- Названия тегов должны быть краткими, профессиональными и взаимоисключающими
- Поле children является необязательным, пропустите его, если нет подтегов
- Убедитесь, что все названия тегов являются осмысленными русскими текстами`,
  },
  "id-ID": {
    schemaName: "TagTree",
    schemaDescription: "Sistem klasifikasi tag tiga tingkat untuk aset digital perusahaan",
    promptIntro: "Kembalikan pohon tag dalam format JSON dengan struktur berikut:",
    level1Label: "Nama Tag Level 1",
    level2Label: "Nama Tag Level 2",
    level3Label1: "Nama Tag Level 3-1",
    level3Label2: "Nama Tag Level 3-2",
    notes: `Catatan:
- Nama tag harus ringkas, profesional, dan saling eksklusif
- Field children bersifat opsional, abaikan jika tidak ada sub-tag
- Pastikan semua nama tag adalah teks bahasa Indonesia yang bermakna`,
  },
  "fr-FR": {
    schemaName: "TagTree",
    schemaDescription:
      "Système de classification de tags à trois niveaux pour les actifs numériques d'entreprise",
    promptIntro:
      "Veuillez renvoyer l'arborescence de tags au format JSON avec la structure suivante:",
    level1Label: "Nom du tag niveau 1",
    level2Label: "Nom du tag niveau 2",
    level3Label1: "Nom du tag niveau 3-1",
    level3Label2: "Nom du tag niveau 3-2",
    notes: `Remarques:
- Les noms de tags doivent être concis, professionnels et mutuellement exclusifs
- Le champ children est optionnel, omettre s'il n'y a pas de sous-tags
- Assurez-vous que tous les noms de tags sont des textes français significatifs`,
  },
  "it-IT": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistema di classificazione tag a tre livelli per risorse digitali aziendali",
    promptIntro: "Restituisci l'albero dei tag in formato JSON con la seguente struttura:",
    level1Label: "Nome tag livello 1",
    level2Label: "Nome tag livello 2",
    level3Label1: "Nome tag livello 3-1",
    level3Label2: "Nome tag livello 3-2",
    notes: `Note:
- I nomi dei tag devono essere concisi, professionali e mutualmente esclusivi
- Il campo children è opzionale, omettere se non ci sono sotto-tag
- Assicurarsi che tutti i nomi dei tag siano testi italiani significativi`,
  },
  "pl-PL": {
    schemaName: "TagTree",
    schemaDescription:
      "Trzypoziomowy system klasyfikacji tagów dla cyfrowych zasobów przedsiębiorstwa",
    promptIntro: "Zwróć drzewo tagów w formacie JSON z następującą strukturą:",
    level1Label: "Nazwa tagu poziomu 1",
    level2Label: "Nazwa tagu poziomu 2",
    level3Label1: "Nazwa tagu poziomu 3-1",
    level3Label2: "Nazwa tagu poziomu 3-2",
    notes: `Uwagi:
- Nazwy tagów powinny być zwięzłe, profesjonalne i wzajemnie wykluczające się
- Pole children jest opcjonalne, pomiń je, jeśli nie ma pod-tagów
- Upewnij się, że wszystkie nazwy tagów są znaczącymi polskimi tekstami`,
  },
  "vi-VN": {
    schemaName: "TagTree",
    schemaDescription: "Hệ thống phân loại thẻ ba cấp cho tài sản kỹ thuật số doanh nghiệp",
    promptIntro: "Vui lòng trả về cây thẻ ở định dạng JSON với cấu trúc sau:",
    level1Label: "Tên thẻ cấp 1",
    level2Label: "Tên thẻ cấp 2",
    level3Label1: "Tên thẻ cấp 3-1",
    level3Label2: "Tên thẻ cấp 3-2",
    notes: `Lưu ý:
- Tên thẻ phải ngắn gọn, chuyên nghiệp và loại trừ lẫn nhau
- Trường children là tùy chọn, bỏ qua nếu không có thẻ con
- Đảm bảo tất cả tên thẻ đều là văn bản tiếng Việt có ý nghĩa`,
  },
  "tr-TR": {
    schemaName: "TagTree",
    schemaDescription: "Kurumsal dijital varlıklar için üç seviyeli etiket sınıflandırma sistemi",
    promptIntro: "Lütfen aşağıdaki yapıyla JSON formatında etiket ağacını döndürün:",
    level1Label: "Seviye 1 Etiket Adı",
    level2Label: "Seviye 2 Etiket Adı",
    level3Label1: "Seviye 3 Etiket Adı-1",
    level3Label2: "Seviye 3 Etiket Adı-2",
    notes: `Notlar:
- Etiket adları kısa, profesyonel ve birbirini dışlayıcı olmalıdır
- children alanı isteğe bağlıdır, alt etiket yoksa atlayın
- Tüm etiket adlarının anlamlı Türkçe metinler olduğundan emin olun`,
  },
  "th-TH": {
    schemaName: "TagTree",
    schemaDescription: "ระบบจำแนกแท็กสามระดับสำหรับสินทรัพย์ดิจิทัลขององค์กร",
    promptIntro: "กรุณาส่งคืนต้นไม้แท็กในรูปแบบ JSON ด้วยโครงสร้างต่อไปนี้:",
    level1Label: "ชื่อแท็กระดับ 1",
    level2Label: "ชื่อแท็กระดับ 2",
    level3Label1: "ชื่อแท็กระดับ 3-1",
    level3Label2: "ชื่อแท็กระดับ 3-2",
    notes: `หมายเหตุ:
- ชื่อแท็กควรกระชับ เป็นมืออาชีพ และไม่ซ้ำกัน
- ฟิลด์ children เป็นทางเลือก ข้ามได้หากไม่มีแท็กย่อย
- ตรวจสอบให้แน่ใจว่าชื่อแท็กทั้งหมดเป็นข้อความภาษาไทยที่มีความหมาย`,
  },
  "de-DE": {
    schemaName: "TagTree",
    schemaDescription: "Dreistufiges Tag-Klassifizierungssystem für Unternehmens-Digitalassets",
    promptIntro: "Bitte geben Sie den Tag-Baum im JSON-Format mit folgender Struktur zurück:",
    level1Label: "Tag-Name Ebene 1",
    level2Label: "Tag-Name Ebene 2",
    level3Label1: "Tag-Name Ebene 3-1",
    level3Label2: "Tag-Name Ebene 3-2",
    notes: `Hinweise:
- Tag-Namen sollten prägnant, professionell und sich gegenseitig ausschließend sein
- Das Feld children ist optional, lassen Sie es weg, wenn es keine Unter-Tags gibt
- Stellen Sie sicher, dass alle Tag-Namen aussagekräftige deutsche Texte sind`,
  },
  "es-ES": {
    schemaName: "TagTree",
    schemaDescription:
      "Sistema de clasificación de etiquetas de tres niveles para activos digitales empresariales",
    promptIntro:
      "Por favor, devuelva el árbol de etiquetas en formato JSON con la siguiente estructura:",
    level1Label: "Nombre de etiqueta nivel 1",
    level2Label: "Nombre de etiqueta nivel 2",
    level3Label1: "Nombre de etiqueta nivel 3-1",
    level3Label2: "Nombre de etiqueta nivel 3-2",
    notes: `Notas:
- Los nombres de las etiquetas deben ser concisos, profesionales y mutuamente excluyentes
- El campo children es opcional, omítalo si no hay sub-etiquetas
- Asegúrese de que todos los nombres de etiquetas sean textos en español significativos`,
  },
  "hi-IN": {
    schemaName: "TagTree",
    schemaDescription: "उद्यम डिजिटल संपत्तियों के लिए तीन-स्तरीय टैग वर्गीकरण प्रणाली",
    promptIntro: "कृपया निम्नलिखित संरचना के साथ JSON प्रारूप में टैग ट्री लौटाएं:",
    level1Label: "स्तर 1 टैग नाम",
    level2Label: "स्तर 2 टैग नाम",
    level3Label1: "स्तर 3 टैग नाम-1",
    level3Label2: "स्तर 3 टैग नाम-2",
    notes: `नोट्स:
- टैग नाम संक्षिप्त, पेशेवर और परस्पर अनन्य होने चाहिए
- children फ़ील्ड वैकल्पिक है, यदि कोई उप-टैग नहीं हैं तो इसे छोड़ दें
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
