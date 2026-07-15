plugins {
    java
}

group = "com.mcecosystem"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    // compileOnly: la API de Paper existe en el servidor en runtime,
    // no se empaqueta dentro del jar del plugin.
    compileOnly("io.papermc.paper:paper-api:26.2.build.60-beta")

    // MockBukkit aún no publica build para 26.2; el de 26.1.2 es
    // API-compatible con lo que usan los listeners.
    testImplementation("org.mockbukkit.mockbukkit:mockbukkit-v26.1.2:4.114.0")
    // La API de test debe COINCIDIR con la versión de MockBukkit: sus datos
    // internos (registries) se generan por versión de Minecraft.
    testImplementation("io.papermc.paper:paper-api:26.1.2.build.74-stable")
    // En producción gson y sqlite los aporta el servidor; en tests hay que traerlos.
    testImplementation("com.google.code.gson:gson:2.11.0")
    testImplementation("org.xerial:sqlite-jdbc:3.53.2.0")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

java {
    toolchain {
        // Paper 26.2 requiere Java 25 (con 21 ni compila).
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.jar {
    archiveFileName = "EventCollector-${version}.jar"
}
