// Generated from tile_map_editor_imgui/assets/config/palette_tag_tree.json
export const paletteTagTree = {
  "version": 2,
  "scope": "exterior",
  "calibrated_against": "my_retro_clean",
  "_note": "引擎自带的权威 role 分类树(taxonomy)。外景 7 顶层的当前定稿见 PALETTE_TAGGING.md §12.3;解析语义见 docs/TAG_SYSTEM_DESIGN.md。子节点为对照 171 张联系表的第一版,可 grow。v2 起顶层主要表达语义大类,不再要求一刀切锁死几何类型; `object_type` / `feeds_modes` 可在任意节点声明,未声明则沿祖先继承,子节点可 override。`stratum`(ground/vertical)仍保持每个节点都显式声明,导入打标时按 role 精确取该节点的 stratum apply 到 palette; ground 语义(terrain_decoration/path/ground_prop/traversal 等)与 vertical 语义(nature_prop/outdoor_prop/building...)因此自然分开。feeds_modes 仍是打标时的 mode 先验(软提示,非硬约束)。内景(room/dungeon)暂缓。",
  "categories": [
    {
      "id": "terrain",
      "label": "地形(面/底表)",
      "object_type": "terrain_area",
      "stratum": "ground",
      "feeds_modes": [
        "TWO_CORNER",
        "CLIFF",
        "QUAD",
        "CONTOUR",
        "BLOB_6_8",
        "BLOB_7_7"
      ],
      "children": [
        {
          "id": "grass",
          "label": "草地",
          "stratum": "ground",
          "children": []
        },
        {
          "id": "dirt",
          "label": "泥土",
          "stratum": "ground",
          "children": []
        },
        {
          "id": "sand",
          "label": "沙地",
          "stratum": "ground",
          "children": []
        },
        {
          "id": "snow",
          "label": "雪地",
          "stratum": "ground",
          "children": []
        },
        {
          "id": "water",
          "label": "水面",
          "stratum": "ground",
          "children": []
        },
        {
          "id": "farm_field",
          "label": "农田",
          "stratum": "ground",
          "children": []
        },
        {
          "id": "cliff",
          "label": "崖/台地(地形高差结构·非2corner自拼)",
          "object_type": "terrain_area",
          "stratum": "ground",
          "feeds_modes": [
            "CLIFF",
            "H_STRETCH",
            "V_STRETCH"
          ],
          "_note": "terrain 大类下的特殊结构: 用 CLIFF mode 自带'顶(ground cell)+面(vertical cell)'分层, 或 H/V_STRETCH 的独立崖面条。stratum=vertical 让面遮挡身后; CLIFF mode 由引擎按 cell 决定 isGround, 不受此影响。",
          "children": []
        }
      ]
    },
    {
      "id": "terrain_decoration",
      "label": "地表装饰(贴地·ground)",
      "object_type": "terrain_area",
      "stratum": "ground",
      "feeds_modes": [
        "TWO_CORNER",
        "TWO_EDGE",
        "CONTOUR",
        "FIXED_RECT",
        "NINE_PATCH",
        "H_STRETCH",
        "V_STRETCH"
      ],
      "_note": "语义上都属于'画在/落在 terrain 地表上的东西'。具体几何类型由更具体节点决定: `surface_detail` 是 terrain_area 覆盖层, `path` 以 terrain_line 为主但子节点可 override 成 terrain_area/fixed_rect, `ground_prop` / `traversal` 则是 ground-stratum 的离散结构。这样 ground 语义集中到一个顶层, 与 vertical 的 nature_prop/outdoor_prop 分开。",
      "children": [
        {
          "id": "surface_detail",
          "label": "表面细节(铺在地表上的覆盖层)",
          "object_type": "terrain_area",
          "stratum": "ground",
          "feeds_modes": [
            "TWO_CORNER",
            "QUAD",
            "CONTOUR",
            "BLOB_6_8",
            "BLOB_7_7"
          ],
          "children": [
            {
              "id": "speckle",
              "label": "碎土/颗粒/噪点",
              "stratum": "ground",
              "children": []
            },
            {
              "id": "ground_cover",
              "label": "落叶/落草/地表覆盖",
              "stratum": "ground",
              "children": []
            },
            {
              "id": "shore_detail",
              "label": "浅滩/岸边点缀",
              "stratum": "ground",
              "children": []
            }
          ]
        },
        {
          "id": "path",
          "label": "地表通道/线性装饰",
          "object_type": "terrain_line",
          "stratum": "ground",
          "feeds_modes": [
            "TWO_EDGE",
            "CONTOUR",
            "TWO_CORNER"
          ],
          "children": [
            {
              "id": "road",
              "label": "道路/路径",
              "stratum": "ground",
              "children": [
                {
                  "id": "line_path",
                  "label": "线状路(TWO_EDGE 描线)",
                  "object_type": "terrain_line",
                  "stratum": "ground",
                  "feeds_modes": [
                    "TWO_EDGE",
                    "CONTOUR"
                  ],
                  "children": []
                },
                {
                  "id": "area_path",
                  "label": "面状铺装/踩踏面(TWO_CORNER 铺面)",
                  "object_type": "terrain_area",
                  "stratum": "ground",
                  "feeds_modes": [
                    "TWO_CORNER",
                    "QUAD"
                  ],
                  "children": []
                }
              ]
            },
            {
              "id": "river",
              "label": "河流/水道",
              "object_type": "terrain_line",
              "stratum": "ground",
              "children": []
            },
            {
              "id": "bridge",
              "label": "桥(贴地通行结构)",
              "object_type": "fixed_rect",
              "stratum": "ground",
              "feeds_modes": [
                "FIXED_RECT",
                "NINE_PATCH",
                "H_STRETCH",
                "V_STRETCH"
              ],
              "_note": "桥按走向分横/竖,compile 据此挑对朝向的 palette。横版多为 H_STRETCH、竖版多为 V_STRETCH(NINE_PATCH/FIXED_RECT 也可,看图形)。",
              "children": [
                {
                  "id": "horizontal",
                  "label": "横桥(左右走向)",
                  "stratum": "ground",
                  "feeds_modes": [
                    "H_STRETCH",
                    "FIXED_RECT",
                    "NINE_PATCH"
                  ],
                  "children": []
                },
                {
                  "id": "vertical",
                  "label": "竖桥(上下走向)",
                  "stratum": "ground",
                  "feeds_modes": [
                    "V_STRETCH",
                    "FIXED_RECT",
                    "NINE_PATCH"
                  ],
                  "children": []
                }
              ]
            }
          ]
        },
        {
          "id": "ground_prop",
          "label": "地表小物(离散·ground)",
          "object_type": "fixed_rect",
          "stratum": "ground",
          "feeds_modes": [
            "FIXED_RECT",
            "NINE_PATCH"
          ],
          "children": [
            {
              "id": "collectable",
              "label": "可收集物(牛奶/果实/爱心等)",
              "stratum": "ground",
              "children": []
            },
            {
              "id": "debris",
              "label": "地面杂物/不可拾取装饰",
              "stratum": "ground",
              "children": []
            },
            {
              "id": "flora",
              "label": "贴地花草/蘑菇",
              "stratum": "ground",
              "children": []
            },
            {
              "id": "pebble",
              "label": "小石子/碎石堆",
              "stratum": "ground",
              "children": []
            }
          ]
        },
        {
          "id": "traversal",
          "label": "高差连接(地面·连两片地形)",
          "object_type": "fixed_rect",
          "stratum": "ground",
          "feeds_modes": [
            "FIXED_RECT",
            "NINE_PATCH",
            "H_STRETCH",
            "V_STRETCH"
          ],
          "_note": "ramp/stair 都是 Ground stratum 的可走结构,连接不同高程的两片地形。方向子节点 up/down/left/right 分别对应朝向,便于四向分开挂图。",
          "children": [
            {
              "id": "ramp",
              "label": "斜坡",
              "stratum": "ground",
              "children": [
                {
                  "id": "up",
                  "label": "上",
                  "stratum": "ground",
                  "children": []
                },
                {
                  "id": "down",
                  "label": "下",
                  "stratum": "ground",
                  "children": []
                },
                {
                  "id": "left",
                  "label": "左",
                  "stratum": "ground",
                  "children": []
                },
                {
                  "id": "right",
                  "label": "右",
                  "stratum": "ground",
                  "children": []
                }
              ]
            },
            {
              "id": "stair",
              "label": "楼梯",
              "stratum": "ground",
              "children": [
                {
                  "id": "up",
                  "label": "上",
                  "stratum": "ground",
                  "children": []
                },
                {
                  "id": "down",
                  "label": "下",
                  "stratum": "ground",
                  "children": []
                },
                {
                  "id": "left",
                  "label": "左",
                  "stratum": "ground",
                  "children": []
                },
                {
                  "id": "right",
                  "label": "右",
                  "stratum": "ground",
                  "children": []
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "boundary",
      "label": "边界(线/垂直·有碰撞)",
      "object_type": "terrain_line",
      "stratum": "vertical",
      "feeds_modes": [
        "TWO_EDGE"
      ],
      "children": [
        {
          "id": "fence",
          "label": "栅栏",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "wall",
          "label": "墙",
          "stratum": "vertical",
          "children": []
        }
      ]
    },
    {
      "id": "nature_prop",
      "label": "自然物(点·立体)",
      "object_type": "fixed_rect",
      "stratum": "vertical",
      "feeds_modes": [
        "FIXED_RECT",
        "NINE_PATCH"
      ],
      "children": [
        {
          "id": "tree",
          "label": "树木",
          "stratum": "vertical",
          "children": [
            {
              "id": "pine",
              "label": "针叶/松",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "bush",
              "label": "灌木/树篱",
              "stratum": "vertical",
              "children": []
            }
          ]
        },
        {
          "id": "rock",
          "label": "岩石(立起来的)",
          "stratum": "vertical",
          "children": [
            {
              "id": "boulder",
              "label": "巨石",
              "stratum": "vertical",
              "children": []
            }
          ]
        },
        {
          "id": "plant",
          "label": "植物(立起来的)",
          "stratum": "vertical",
          "children": [
            {
              "id": "flower",
              "label": "花(高于地表、非贴地覆盖)",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "mushroom",
              "label": "蘑菇(立起来的)",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "crop",
              "label": "作物/果实",
              "stratum": "vertical",
              "children": []
            }
          ]
        }
      ]
    },
    {
      "id": "outdoor_prop",
      "label": "人造设施(点·独立)",
      "object_type": "fixed_rect",
      "stratum": "vertical",
      "feeds_modes": [
        "FIXED_RECT",
        "NINE_PATCH",
        "H_STRETCH",
        "V_STRETCH"
      ],
      "children": [
        {
          "id": "furniture",
          "label": "家具/陈设",
          "stratum": "vertical",
          "children": [
            {
              "id": "bench",
              "label": "长椅/桌",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "barrel",
              "label": "桶/箱",
              "stratum": "vertical",
              "children": []
            }
          ]
        },
        {
          "id": "facility",
          "label": "设施",
          "stratum": "vertical",
          "children": [
            {
              "id": "well",
              "label": "水井",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "fountain",
              "label": "喷泉",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "lantern",
              "label": "灯/路灯",
              "stratum": "vertical",
              "children": []
            },
            {
              "id": "statue",
              "label": "雕像",
              "stratum": "vertical",
              "children": []
            }
          ]
        },
        {
          "id": "market_stall",
          "label": "集市摊位",
          "stratum": "vertical",
          "children": []
        }
      ]
    },
    {
      "id": "building",
      "label": "建筑主体(块·强碰撞)",
      "object_type": "fixed_rect",
      "stratum": "vertical",
      "feeds_modes": [
        "FIXED_RECT",
        "NINE_PATCH",
        "CLIFF",
        "H_STRETCH",
        "V_STRETCH"
      ],
      "children": [
        {
          "id": "house",
          "label": "房屋(整体立面)",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "house_roof",
          "label": "房顶(HouseObject roof 槽)",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "house_wall",
          "label": "房屋墙面(HouseObject wall 槽)",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "shop",
          "label": "商店",
          "stratum": "vertical",
          "children": [
            {
              "id": "tavern",
              "label": "酒馆",
              "stratum": "vertical",
              "children": []
            }
          ]
        },
        {
          "id": "tower",
          "label": "塔",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "ruin",
          "label": "废墟",
          "stratum": "vertical",
          "children": []
        }
      ]
    },
    {
      "id": "building_prop",
      "label": "建筑附着物(贴墙/屋顶)",
      "object_type": "fixed_rect",
      "stratum": "vertical",
      "feeds_modes": [
        "FIXED_RECT",
        "NINE_PATCH"
      ],
      "children": [
        {
          "id": "window",
          "label": "窗",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "door",
          "label": "门",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "signboard",
          "label": "招牌",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "chimney",
          "label": "烟囱",
          "stratum": "vertical",
          "children": []
        },
        {
          "id": "banner",
          "label": "旗/横幅",
          "stratum": "vertical",
          "children": []
        }
      ]
    }
  ]
} as const;
