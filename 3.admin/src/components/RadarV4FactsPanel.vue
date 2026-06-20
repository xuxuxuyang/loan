<script setup lang="ts">
import { computed } from 'vue'
import { chunkRadarFactPairs, groupRadarV4FactsForTables } from '../utils/radarV4ReputationFacts'
import type { RiskFactLine } from '../utils/riskRowFactLines'

const props = defineProps<{
  facts: RiskFactLine[]
}>()

const RADAR_FACT_PAIR_COLUMNS = 3
const RADAR_TABLE_COLSPAN = RADAR_FACT_PAIR_COLUMNS * 2
const radarPairHeadIndexes = Array.from({ length: RADAR_FACT_PAIR_COLUMNS }, (_, i) => i)

const factsGrouped = computed(() => groupRadarV4FactsForTables(props.facts))
</script>

<template>
  <div
    v-if="facts.length > 0"
    class="user-risk-radar-facts-wrap"
  >
    <template
      v-if="factsGrouped.sections.length > 0 || factsGrouped.reportNote"
    >
      <!-- <p
        v-if="factsGrouped.reportNote"
        class="user-risk-radar-report-note"
      >
        {{ factsGrouped.reportNote }}
      </p> -->
      <div
        v-for="(sec, si) in factsGrouped.sections"
        :key="si"
        class="user-risk-radar-sec"
      >
        <div class="user-risk-radar-sec__head">
          <h4 class="user-risk-radar-sec__title">
            {{ sec.title }}
          </h4>
          <p
            v-if="sec.subtitle"
            class="user-risk-radar-sec__sub"
          >
            {{ sec.subtitle }}
          </p>
        </div>
        <div class="user-risk-radar-table-scroll">
          <table
            class="user-risk-radar-table user-risk-radar-table--multi"
            :aria-label="`${sec.title}指标`"
          >
            <thead>
              <tr>
                <template
                  v-for="hi in radarPairHeadIndexes"
                  :key="hi"
                >
                  <th scope="col">
                    指标
                  </th>
                  <th scope="col">
                    取值
                  </th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!sec.rows.length">
                <td
                  :colspan="RADAR_TABLE_COLSPAN"
                  class="user-risk-radar-table__empty"
                >
                  查询无数据
                </td>
              </tr>
              <template v-else>
                <tr
                  v-for="(chunk, ci) in chunkRadarFactPairs(sec.rows, RADAR_FACT_PAIR_COLUMNS)"
                  :key="ci"
                >
                  <template
                    v-for="(cell, idx) in chunk"
                    :key="idx"
                  >
                    <td class="user-risk-radar-table__label">
                      {{ cell.label }}
                    </td>
                    <td
                      class="user-risk-radar-table__value"
                      :class="{ 'user-risk-radar-table__value--emphasis': cell.emphasis }"
                    >
                      {{ cell.value }}
                    </td>
                  </template>
                  <td
                    v-if="chunk.length < RADAR_FACT_PAIR_COLUMNS"
                    :colspan="(RADAR_FACT_PAIR_COLUMNS - chunk.length) * 2"
                    class="user-risk-radar-table__pad"
                  ></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
      <div
        v-if="factsGrouped.extras.length"
        class="user-risk-radar-sec"
      >
        <div class="user-risk-radar-sec__head">
          <h4 class="user-risk-radar-sec__title">
            其它信息
          </h4>
        </div>
        <div class="user-risk-radar-table-scroll">
          <table
            class="user-risk-radar-table user-risk-radar-table--multi"
            aria-label="其它信息"
          >
            <thead>
              <tr>
                <template
                  v-for="hi in radarPairHeadIndexes"
                  :key="hi"
                >
                  <th scope="col">
                    项目
                  </th>
                  <th scope="col">
                    内容
                  </th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(chunk, ci) in chunkRadarFactPairs(factsGrouped.extras, RADAR_FACT_PAIR_COLUMNS)"
                :key="ci"
              >
                <template
                  v-for="(ex, idx) in chunk"
                  :key="idx"
                >
                  <td class="user-risk-radar-table__label">
                    {{ ex.label }}
                  </td>
                  <td
                    class="user-risk-radar-table__value"
                    :class="{ 'user-risk-radar-table__value--emphasis': ex.emphasis }"
                  >
                    {{ ex.value }}
                  </td>
                </template>
                <td
                  v-if="chunk.length < RADAR_FACT_PAIR_COLUMNS"
                  :colspan="(RADAR_FACT_PAIR_COLUMNS - chunk.length) * 2"
                  class="user-risk-radar-table__pad"
                ></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="user-risk-radar-table-scroll">
        <table
          class="user-risk-radar-table user-risk-radar-table--multi"
          aria-label="全景雷达数据"
        >
          <thead>
            <tr>
              <template
                v-for="hi in radarPairHeadIndexes"
                :key="hi"
              >
                <th scope="col">
                  项目
                </th>
                <th scope="col">
                  内容
                </th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(chunk, ci) in chunkRadarFactPairs(facts, RADAR_FACT_PAIR_COLUMNS)"
              :key="ci"
            >
              <template
                v-for="(fl, idx) in chunk"
                :key="idx"
              >
                <td class="user-risk-radar-table__label">
                  {{ fl.label }}
                </td>
                <td
                  class="user-risk-radar-table__value"
                  :class="{ 'user-risk-radar-table__value--emphasis': fl.emphasis }"
                >
                  {{ fl.value }}
                </td>
              </template>
              <td
                v-if="chunk.length < RADAR_FACT_PAIR_COLUMNS"
                :colspan="(RADAR_FACT_PAIR_COLUMNS - chunk.length) * 2"
                class="user-risk-radar-table__pad"
              ></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.user-risk-radar-facts-wrap {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.user-risk-radar-report-note {
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.user-risk-radar-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-risk-radar-sec__head {
  padding: 0 2px;
}

.user-risk-radar-sec__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.02em;
}

.user-risk-radar-sec__sub {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: #64748b;
}

.user-risk-radar-table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
}

.user-risk-radar-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
}

.user-risk-radar-table--multi {
  table-layout: fixed;
}

.user-risk-radar-table--multi .user-risk-radar-table__label {
  width: 15%;
  max-width: none;
}

.user-risk-radar-table__pad {
  border-bottom: 1px solid #f1f5f9;
  background: #fafbfc;
}

.user-risk-radar-table thead th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: #475569;
  background: linear-gradient(180deg, #f1f5f9 0%, #e8eef5 100%);
  border-bottom: 1px solid #cbd5e1;
  white-space: nowrap;
}

.user-risk-radar-table tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}

.user-risk-radar-table tbody tr:last-child td {
  border-bottom: none;
}

.user-risk-radar-table tbody tr:nth-child(even) td {
  background: #fafbfc;
}

.user-risk-radar-table__label {
  width: 46%;
  max-width: 280px;
  color: #334155;
  font-weight: 500;
}

.user-risk-radar-table__value {
  color: #0f172a;
  word-break: break-word;
}

.user-risk-radar-table__value--emphasis {
  font-weight: 700;
  color: #1d4ed8;
}

.user-risk-radar-table__empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 16px 12px;
}
</style>
