public class Main 
{
    public static void main(String[] args) 
    {
        DisPlay window = new DisPlay("Flappy Bird");
        window.loadBackground("src/img/backGround.png"); // 背景画像のパス
        window.loadForeground("src/img/map.png"); // フロント画像のパス
        window.loadPlayer("src/img/Bird.png"); // プレイヤー画像のパス
    }
}
