<script setup lang="ts">
import RegisterForm from '~/components/auth/RegisterForm.vue'

definePageMeta({
  layout: false,
})
</script>

<template>
  <div class="min-h-screen bg-[#f4f6f8]">
    <RegisterForm />
  </div>
</template>
