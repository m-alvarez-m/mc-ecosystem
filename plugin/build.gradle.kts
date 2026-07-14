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
