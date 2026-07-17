plugins {
    java
}

group = "com.mcecosystem"
version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
    // API de SkinsRestorer.
    maven("https://repo.codemc.org/repository/maven-releases/")
}

dependencies {
    // compileOnly: la API de Paper existe en el servidor en runtime,
    // no se empaqueta dentro del jar del plugin. 26.1.2 = versión mínima
    // soportada (ADR-002); el jar corre igual en versiones más nuevas.
    compileOnly("io.papermc.paper:paper-api:26.1.2.build.74-stable")
    // La aporta el plugin SkinsRestorer en runtime (depend en plugin.yml).
    compileOnly("net.skinsrestorer:skinsrestorer-api:15.12.4")
    // gson lo aporta el servidor en runtime.
    compileOnly("com.google.code.gson:gson:2.11.0")

    testImplementation("org.mockbukkit.mockbukkit:mockbukkit-v26.1.2:4.114.0")
    testImplementation("io.papermc.paper:paper-api:26.1.2.build.74-stable")
    testImplementation("com.google.code.gson:gson:2.11.0")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

java {
    toolchain {
        // Mismo estándar que EventCollector (Paper 26.x exige Java 25).
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.jar {
    archiveFileName = "EventFX-${version}.jar"
}
