/**
 * Ngân hàng câu đố theo chủ đề.
 * Mỗi item: { type: 'img' | 'emoji', src | emoji, answer, aliases? }
 * Muốn thêm chủ đề/câu đố: thêm object vào CATEGORIES (id phải duy nhất).
 */

const flag = (code, answer, aliases = []) => ({
  type: 'img',
  src: `https://flagcdn.com/w640/${code}.png`,
  answer,
  aliases,
});

const em = (emoji, answer, aliases = []) => ({ type: 'emoji', emoji, answer, aliases });

export const CATEGORIES = [
  {
    id: 'flags',
    name: 'Quốc kỳ',
    icon: '🏳️',
    items: [
      flag('vn', 'Việt Nam'), flag('us', 'Hoa Kỳ', ['Mỹ', 'USA']), flag('gb', 'Anh', ['Vương quốc Anh', 'UK']),
      flag('fr', 'Pháp'), flag('de', 'Đức'), flag('it', 'Ý'), flag('es', 'Tây Ban Nha'),
      flag('pt', 'Bồ Đào Nha'), flag('jp', 'Nhật Bản'), flag('kr', 'Hàn Quốc'), flag('cn', 'Trung Quốc'),
      flag('in', 'Ấn Độ'), flag('th', 'Thái Lan'), flag('sg', 'Singapore'), flag('my', 'Malaysia'),
      flag('id', 'Indonesia'), flag('ph', 'Philippines'), flag('au', 'Úc'), flag('nz', 'New Zealand'),
      flag('ca', 'Canada'), flag('br', 'Brazil'), flag('ar', 'Argentina'), flag('mx', 'Mexico'),
      flag('eg', 'Ai Cập'), flag('za', 'Nam Phi'), flag('ru', 'Nga'), flag('tr', 'Thổ Nhĩ Kỳ'),
      flag('se', 'Thụy Điển'), flag('ch', 'Thụy Sĩ'), flag('nl', 'Hà Lan'), flag('be', 'Bỉ'),
      flag('gr', 'Hy Lạp'), flag('pl', 'Ba Lan'), flag('ua', 'Ukraina'), flag('sa', 'Ả Rập Xê Út'),
      flag('ae', 'UAE', ['Các Tiểu vương quốc Ả Rập Thống nhất']), flag('la', 'Lào'),
      flag('kh', 'Campuchia'), flag('cl', 'Chile'), flag('no', 'Na Uy'),
    ],
  },
  {
    id: 'animals',
    name: 'Động vật',
    icon: '🦁',
    items: [
      em('🐶', 'Chó'), em('🐱', 'Mèo'), em('🐭', 'Chuột'), em('🐹', 'Chuột hamster', ['Hamster']),
      em('🐰', 'Thỏ'), em('🦊', 'Cáo'), em('🐻', 'Gấu'), em('🐼', 'Gấu trúc'), em('🐨', 'Koala'),
      em('🐯', 'Hổ', ['Cọp']), em('🦁', 'Sư tử'), em('🐮', 'Bò'), em('🐷', 'Heo', ['Lợn']),
      em('🐸', 'Ếch'), em('🐵', 'Khỉ'), em('🐔', 'Gà'), em('🐧', 'Chim cánh cụt'), em('🦆', 'Vịt'),
      em('🦉', 'Cú'), em('🦇', 'Dơi'), em('🐺', 'Sói'), em('🐴', 'Ngựa'), em('🦄', 'Kỳ lân'),
      em('🐝', 'Ong'), em('🦋', 'Bướm'), em('🐌', 'Ốc sên'), em('🐢', 'Rùa'), em('🐍', 'Rắn'),
      em('🐙', 'Bạch tuộc'), em('🦀', 'Cua'), em('🐬', 'Cá heo'), em('🐳', 'Cá voi'),
      em('🦈', 'Cá mập'), em('🐘', 'Voi'), em('🦒', 'Hươu cao cổ'), em('🦓', 'Ngựa vằn'),
      em('🦘', 'Kangaroo', ['Chuột túi']), em('🐫', 'Lạc đà'), em('🦔', 'Nhím'), em('🐊', 'Cá sấu'),
    ],
  },
  {
    id: 'food',
    name: 'Ẩm thực',
    icon: '🍜',
    items: [
      em('🍎', 'Táo'), em('🍌', 'Chuối'), em('🍇', 'Nho'), em('🍉', 'Dưa hấu'), em('🍊', 'Cam'),
      em('🍋', 'Chanh'), em('🍍', 'Dứa', ['Thơm', 'Khóm']), em('🥭', 'Xoài'), em('🍓', 'Dâu tây'),
      em('🍒', 'Cherry', ['Anh đào']), em('🍑', 'Đào'), em('🥥', 'Dừa'), em('🥑', 'Bơ'),
      em('🍅', 'Cà chua'), em('🥕', 'Cà rốt'), em('🌽', 'Ngô', ['Bắp']), em('🥦', 'Bông cải xanh', ['Súp lơ xanh']),
      em('🍄', 'Nấm'), em('🥔', 'Khoai tây'), em('🍞', 'Bánh mì'), em('🧀', 'Phô mai'),
      em('🍕', 'Pizza'), em('🍔', 'Hamburger'), em('🌭', 'Hot dog', ['Xúc xích']),
      em('🍟', 'Khoai tây chiên'), em('🍜', 'Mì', ['Phở', 'Mì ly']), em('🍣', 'Sushi'),
      em('🍩', 'Bánh donut'), em('🍦', 'Kem'), em('🍫', 'Sô cô la', ['Chocolate']),
    ],
  },
  {
    id: 'vehicles',
    name: 'Phương tiện',
    icon: '🚀',
    items: [
      em('🚗', 'Ô tô', ['Xe hơi']), em('🚕', 'Taxi'), em('🚌', 'Xe buýt'), em('🚑', 'Xe cứu thương'),
      em('🚒', 'Xe cứu hỏa'), em('🚓', 'Xe cảnh sát'), em('🚜', 'Máy kéo'), em('🏍️', 'Mô tô', ['Xe máy']),
      em('🛵', 'Xe tay ga'), em('🚲', 'Xe đạp'), em('🛴', 'Xe trượt scooter', ['Scooter']),
      em('🚂', 'Tàu hỏa', ['Đầu máy hơi nước']), em('🚄', 'Tàu cao tốc'), em('✈️', 'Máy bay'),
      em('🚁', 'Trực thăng'), em('🚀', 'Tên lửa'), em('🛸', 'Đĩa bay', ['UFO']), em('⛵', 'Thuyền buồm'),
      em('🚢', 'Tàu thủy'), em('🛶', 'Ca nô', ['Xuồng']), em('🚡', 'Cáp treo'),
      em('🛺', 'Xích lô máy', ['Tuk tuk']), em('🛹', 'Ván trượt'), em('🚤', 'Ca nô cao tốc'),
    ],
  },
  {
    id: 'objects',
    name: 'Đồ vật',
    icon: '💡',
    items: [
      em('⌚', 'Đồng hồ đeo tay'), em('📱', 'Điện thoại'), em('💻', 'Laptop', ['Máy tính xách tay']),
      em('⌨️', 'Bàn phím'), em('🖨️', 'Máy in'), em('📷', 'Máy ảnh'), em('🔦', 'Đèn pin'),
      em('💡', 'Bóng đèn'), em('🔋', 'Pin'), em('🔑', 'Chìa khóa'), em('🔒', 'Ổ khóa'),
      em('✂️', 'Cái kéo', ['Kéo']), em('📎', 'Kẹp giấy'), em('📌', 'Ghim'), em('🔨', 'Búa'),
      em('🔧', 'Cờ lê'), em('🧲', 'Nam châm'), em('🔭', 'Kính thiên văn'), em('🔬', 'Kính hiển vi'),
      em('🎒', 'Balo', ['Cặp sách']), em('🕶️', 'Kính râm'), em('☂️', 'Ô', ['Dù']), em('🪑', 'Ghế'),
      em('🛏️', 'Giường'), em('🚪', 'Cửa'), em('🧭', 'La bàn'), em('⏰', 'Đồng hồ báo thức'),
      em('🎸', 'Đàn guitar'), em('🥁', 'Trống'), em('🎹', 'Đàn piano'),
    ],
  },
  {
    id: 'sports',
    name: 'Thể thao',
    icon: '⚽',
    items: [
      em('⚽', 'Bóng đá'), em('🏀', 'Bóng rổ'), em('🏈', 'Bóng bầu dục'), em('⚾', 'Bóng chày'),
      em('🎾', 'Tennis'), em('🏐', 'Bóng chuyền'), em('🏓', 'Bóng bàn'), em('🏸', 'Cầu lông'),
      em('🥊', 'Quyền Anh', ['Boxing', 'Găng đấm bốc']), em('🥋', 'Võ thuật', ['Karate', 'Judo', 'Võ phục']),
      em('🏹', 'Bắn cung'), em('🎳', 'Bowling'), em('⛳', 'Golf'), em('🏒', 'Khúc côn cầu'),
      em('🎯', 'Phi tiêu'), em('🏊', 'Bơi lội'), em('🚴', 'Đua xe đạp'), em('🏋️', 'Cử tạ'),
      em('🤸', 'Thể dục dụng cụ'), em('⛸️', 'Trượt băng'), em('🎿', 'Trượt tuyết'),
      em('🏆', 'Cúp vô địch', ['Cúp']), em('🥇', 'Huy chương vàng'),
    ],
  },
  {
    id: 'nature',
    name: 'Thiên nhiên',
    icon: '🌋',
    items: [
      em('☀️', 'Mặt trời'), em('🌙', 'Mặt trăng'), em('⭐', 'Ngôi sao'), em('☁️', 'Mây'),
      em('🌧️', 'Mưa'), em('⛈️', 'Giông bão', ['Sấm sét']), em('❄️', 'Bông tuyết', ['Tuyết']),
      em('🌈', 'Cầu vồng'), em('🔥', 'Lửa'), em('💧', 'Giọt nước', ['Nước']), em('🌊', 'Sóng biển', ['Sóng']),
      em('🌋', 'Núi lửa'), em('🏔️', 'Núi tuyết', ['Núi']), em('🏝️', 'Đảo'), em('🌵', 'Xương rồng'),
      em('🌴', 'Cây dừa', ['Cây cọ']), em('🌲', 'Cây thông'), em('🌻', 'Hoa hướng dương'),
      em('🌹', 'Hoa hồng'), em('🌷', 'Hoa tulip'), em('🍀', 'Cỏ bốn lá'), em('🍁', 'Lá phong'),
      em('🌍', 'Trái đất'), em('🪐', 'Sao Thổ'), em('☄️', 'Sao chổi'), em('🌪️', 'Lốc xoáy'),
    ],
  },
];

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
}
