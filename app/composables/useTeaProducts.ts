export interface TeaProduct {
  id: number
  name: string
  subtitle: string
  description: string
  origin: string
  price: number
  image: string
}

const teaProducts: TeaProduct[] = [
  {
    id: 1,
    name: '明前西湖龙井',
    subtitle: '豆香清雅，鲜爽甘润',
    description: '采摘于早春核心产区，叶形扁平挺秀，滋味鲜醇持久，适合日常高端品饮。',
    origin: '浙江杭州',
    price: 1280,
    image: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: 2,
    name: '武夷山大红袍',
    subtitle: '岩骨花香，层次丰富',
    description: '传统炭焙工艺打造，汤色橙红透亮，入口醇厚回甘，适合收藏与礼赠。',
    origin: '福建武夷山',
    price: 1680,
    image: 'https://images.unsplash.com/photo-1597318181409-cf64d0b5d8a2?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: 3,
    name: '古树普洱熟茶',
    subtitle: '陈香浓郁，顺滑温润',
    description: '甄选云南古树春料发酵，茶汤醇厚细腻，口感饱满圆润，适合秋冬暖饮。',
    origin: '云南西双版纳',
    price: 980,
    image: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: 4,
    name: '安溪铁观音',
    subtitle: '兰香高扬，韵味悠长',
    description: '半发酵乌龙工艺，茶香高雅，回味甘甜生津，兼具清香与厚度。',
    origin: '福建安溪',
    price: 1120,
    image: 'https://images.unsplash.com/photo-1515823662972-da6a2e4d3002?auto=format&fit=crop&w=1400&q=80',
  },
  {
    id: 5,
    name: '福鼎白毫银针',
    subtitle: '毫香蜜韵，清甜鲜柔',
    description: '芽头饱满披毫显白，汤感柔和清甜，具备良好的陈化潜力，品质稳定。',
    origin: '福建福鼎',
    price: 1480,
    image: 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?auto=format&fit=crop&w=1400&q=80',
  },
]

function shuffleProducts(list: TeaProduct[]) {
  const copied = [...list]

  for (let index = copied.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const current = copied[index]
    const random = copied[randomIndex]

    if (!current || !random) {
      continue
    }

    copied[index] = random
    copied[randomIndex] = current
  }

  return copied
}

export function useTeaProducts() {
  return useState<TeaProduct[]>('index-tea-products', () => shuffleProducts(teaProducts))
}
